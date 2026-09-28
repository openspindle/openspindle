import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { utilityProcess } from "electron"
import type { UtilityProcess } from "electron"
import { RpcError, createEndpoint } from "@openspindle/rpc"
import type { Handlers, Peer, Transport } from "@openspindle/rpc"
import { ndjsonTransport } from "@openspindle/rpc/ndjson"
import {
  COMPANION_PROTOCOL,
  PLUGIN_API,
  companionContract,
  companionEntry,
  companionHostContract,
  createCapabilityGuard,
  heldRequirements,
} from "@openspindle/plugin-core"
import type {
  CompanionContract,
  CompanionHealth,
  CompanionHostContract,
  CompanionStatus,
  InstalledPluginRecord,
  JsonValue,
  Platform,
} from "@openspindle/plugin-core"
import { streamChannel } from "@openspindle/plugin-sdk/node"
import type { MachineGateway } from "../../../src/machine/core/gateway.ts"
import type {
  CompanionEvent,
  CompanionLogEntry,
} from "../../../src/platform/contract/plugin-rpc"
import { machine } from "../rpc/machine-errors"
import type { PluginRegistry } from "./registry"

const HANDSHAKE_TIMEOUT_MS = 15_000
const INVOKE_TIMEOUT_MS = 10 * 60_000
const SHUTDOWN_TIMEOUT_MS = 2_000
const STOP_GRACE_MS = 3_000
const CRASH_WINDOW_MS = 10 * 60_000
const MAX_CRASHES = 5
const MAX_BACKOFF_MS = 30_000
const LOG_CAPACITY = 500
const LOG_LINE_CHARS = 2_000
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024

/** Nothing else from the app's environment reaches a companion (no tokens, no NODE_OPTIONS). */
const ENVIRONMENT_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TZ",
  "SystemRoot",
  "WINDIR",
  "SYSTEMDRIVE",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
] as const

type CompanionPaths = {
  readonly package: string
  readonly data: string
  readonly tmp: string
}

/** A bounded, per-plugin log: host lifecycle notes, companion log calls and output. */
class LogRing {
  private readonly entries: CompanionLogEntry[] = []

  push(entry: Omit<CompanionLogEntry, "at">) {
    this.entries.push({
      ...entry,
      at: Date.now(),
      message: entry.message.slice(0, LOG_LINE_CHARS),
    })
    if (this.entries.length > LOG_CAPACITY)
      this.entries.splice(0, this.entries.length - LOG_CAPACITY)
  }

  list(): CompanionLogEntry[] {
    return [...this.entries]
  }
}

function captureLines(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void
) {
  if (!stream) return
  let pending = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => {
    const lines = `${pending}${chunk}`.split(/\r?\n/)
    pending = lines.pop() ?? ""
    if (pending.length > LOG_LINE_CHARS) {
      lines.push(pending)
      pending = ""
    }
    for (const line of lines) if (line.trim()) onLine(line)
  })
  stream.on("end", () => {
    if (pending.trim()) onLine(pending)
  })
  stream.on("error", () => undefined)
}

/** A started companion: its private channel, its own tmp folder, its end, and a way to end it. */
type CompanionProcess = {
  readonly transport: Transport
  /** This launch's own folder (see CompanionSupervisor.paths): never another launch's. */
  readonly tmp: string
  /** Resolves with a description once the process has ended, however it ended. */
  readonly exited: Promise<string>
  kill: (force: boolean) => void
}

function utilityTransport(child: UtilityProcess): Transport {
  return {
    send: (message) => child.postMessage(message),
    listen(onMessage, onClose) {
      const receive = (message: unknown) => onMessage(message)
      const exit = () => onClose("The companion exited.")
      child.on("message", receive)
      child.on("exit", exit)
      return () => {
        child.off("message", receive)
        child.off("exit", exit)
      }
    },
    // The supervisor owns the process; closing the channel does not end it.
    close: () => undefined,
  }
}

/** Node companions run in an Electron utility process and talk over its parent port. */
function startNode(
  entry: string,
  args: readonly string[],
  options: {
    cwd: string
    env: Record<string, string>
    name: string
    tmp: string
  },
  logs: LogRing
): CompanionProcess {
  const child = utilityProcess.fork(entry, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: "pipe",
    serviceName: options.name,
  })
  captureLines(child.stdout, (message) =>
    logs.push({ level: "info", source: "stdout", message })
  )
  captureLines(child.stderr, (message) =>
    logs.push({ level: "warn", source: "stderr", message })
  )
  // A fatal V8 error ends the process and its exit is handled as a crash; an unheard
  // error event would instead throw in the main process.
  child.on("error", (_type, location) =>
    logs.push({
      level: "error",
      source: "host",
      message: `The companion failed with a fatal error at ${location}.`,
    })
  )
  return {
    transport: utilityTransport(child),
    tmp: options.tmp,
    exited: new Promise((resolve) =>
      child.once("exit", (code) => resolve(`exited with code ${code}`))
    ),
    // Electron's utility process only ever asks nicely (the POSIX equivalent of SIGTERM,
    // with no signal of its own to escalate to); a force kill reaches for its OS pid
    // instead, the only way through Electron's API to make sure it actually ends.
    kill: (force) => {
      if (force && child.pid !== undefined) {
        try {
          process.kill(child.pid, "SIGKILL")
          return
        } catch {
          // Already gone, or the signal could not be delivered; ask it nicely instead.
        }
      }
      child.kill()
    },
  }
}

/** Native companions: a fixed argv, no shell, NDJSON on stdio. */
function startNative(
  executable: string,
  args: readonly string[],
  options: { cwd: string; env: Record<string, string>; tmp: string },
  logs: LogRing
): CompanionProcess {
  const child = spawn(executable, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  // A write after the process ended must not become an uncaught error in main.
  child.stdin.on("error", () => undefined)
  captureLines(child.stderr, (message) =>
    logs.push({ level: "warn", source: "stderr", message })
  )
  return {
    transport: ndjsonTransport(
      streamChannel(child.stdout, child.stdin, "The companion's output"),
      {
        onInvalidLine: (message) =>
          logs.push({ level: "info", source: "stdout", message }),
      }
    ),
    tmp: options.tmp,
    exited: new Promise((resolve) => {
      child.once("error", (error) =>
        resolve(`could not start (${error.message})`)
      )
      child.once("exit", (code, signal) =>
        resolve(signal ? `was stopped (${signal})` : `exited with code ${code}`)
      )
    }),
    kill: (force) => {
      child.kill(force ? "SIGKILL" : "SIGTERM")
    },
  }
}

function companionEnvironment(
  record: InstalledPluginRecord,
  paths: CompanionPaths
): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const key of ENVIRONMENT_ALLOWLIST) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  return {
    ...environment,
    TMPDIR: paths.tmp,
    TMP: paths.tmp,
    TEMP: paths.tmp,
    OPENSPINDLE_PLUGIN_ID: record.id,
    OPENSPINDLE_PLUGIN_VERSION: record.version,
    OPENSPINDLE_PLUGIN_ROOT: paths.package,
    OPENSPINDLE_PLUGIN_DATA: paths.data,
    OPENSPINDLE_PLUGIN_TMP: paths.tmp,
  }
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const describe = (error: unknown) =>
  error instanceof Error ? error.message : "an unknown error"

export type CompanionDeps = {
  readonly registry: PluginRegistry
  readonly platform: Platform
  readonly dataRoot: string
  readonly tmpRoot: string
  /** The plugin's machine principal, built from its current grants. */
  readonly gateway: (record: InstalledPluginRecord) => MachineGateway
  readonly onStatus: () => void
}

/**
 * One plugin's companion: starts it on demand (or while views hold it), performs the
 * handshake, stops it when idle, and backs off after crashes until a retry limit.
 */
class CompanionSupervisor {
  readonly logs = new LogRing()
  private state: CompanionStatus["state"] = "stopped"
  private health: CompanionHealth | null = null
  /** Whether the companion's setup does anything, as its handshake said. */
  private hasSetup = false
  private process: CompanionProcess | null = null
  private peer: Peer<CompanionContract> | null = null
  private starting: Promise<Peer<CompanionContract>> | null = null
  private stopping: Promise<void> | null = null
  private crashes: number[] = []
  private restarts = 0
  private lastError: string | null = null
  private retryAt: number | null = null
  private inFlight = 0
  private readonly leases = new Set<(event: CompanionEvent) => void>()
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly pluginId: string,
    private readonly deps: CompanionDeps
  ) {}

  status(): CompanionStatus {
    return {
      state: this.state,
      health: this.health,
      setup: this.hasSetup,
      restarts: this.restarts,
      lastError: this.lastError,
      retryAt: this.retryAt,
    }
  }

  async call<T>(
    run: (peer: Peer<CompanionContract>) => Promise<T>
  ): Promise<T> {
    this.inFlight += 1
    this.clearIdle()
    try {
      return await run(await this.ensureRunning())
    } catch (error) {
      if (
        error instanceof RpcError &&
        error.code === "CANCELLED" &&
        this.state !== "running"
      )
        throw new RpcError(
          "UNAVAILABLE",
          `The companion stopped: ${this.lastError ?? "it was shut down"}.`
        )
      throw error
    } finally {
      this.inFlight -= 1
      this.scheduleIdle()
    }
  }

  invoke(
    method: string,
    params: JsonValue | undefined,
    signal: AbortSignal
  ): Promise<JsonValue> {
    return this.call((peer) =>
      peer.call(
        "invoke",
        params === undefined ? { method } : { method, params },
        { signal, timeoutMs: INVOKE_TIMEOUT_MS }
      )
    )
  }

  async setup(signal: AbortSignal): Promise<CompanionHealth> {
    const health = await this.call((peer) =>
      peer.call("setup", undefined, { signal })
    )
    this.health = health
    this.changed()
    return health
  }

  /** Views hold the companion while they are open; on-view companions start at once. */
  hold(listener: (event: CompanionEvent) => void): () => void {
    this.leases.add(listener)
    this.clearIdle()
    listener({ kind: "status", status: this.status() })
    if (this.activation() === "on-view" && this.state !== "failed")
      this.ensureRunning().catch(() => undefined)
    return () => {
      this.leases.delete(listener)
      // Nobody holds it any more: a pending automatic restart is not needed.
      if (!this.leases.size) this.clearRetry()
      this.scheduleIdle()
    }
  }

  async restart(): Promise<CompanionStatus> {
    await this.stop("Restarted.")
    this.crashes = []
    await this.ensureRunning()
    return this.status()
  }

  /**
   * Asks the companion to exit, then ends it after a grace period. Concurrent callers share
   * one attempt (see doStop); a start already under way is let to finish first, so this acts
   * on whatever is actually running instead of missing it mid-launch.
   */
  stop(note: string): Promise<void> {
    this.stopping ??= this.doStop(note).finally(() => {
      this.stopping = null
    })
    return this.stopping
  }

  private async doStop(note: string): Promise<void> {
    this.clearIdle()
    this.clearRetry()
    this.retryAt = null
    if (this.starting) await this.starting.catch(() => undefined)
    const current = this.process
    const peer = this.peer
    if (!current) {
      if (this.state !== "stopped") this.setState("stopped")
      return
    }
    this.setState("stopping")
    await peer
      ?.call("openspindle.shutdown", undefined, {
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      })
      .catch(() => undefined)
    const ended = await Promise.race([
      current.exited.then(() => true),
      delay(STOP_GRACE_MS).then(() => false),
    ])
    if (!ended) current.kill(true)
    peer?.close()
    // A newer process may already have replaced this one (app quit's synchronous kill() can
    // interleave here): only its own state and its own temporary files are this stop's to clear.
    if (this.process !== current) return
    this.process = null
    this.peer = null
    this.logs.push({ level: "info", source: "host", message: note })
    await rm(current.tmp, { recursive: true, force: true })
    this.setState("stopped")
  }

  /** Synchronous end for app quit. */
  kill() {
    this.clearIdle()
    this.clearRetry()
    this.process?.kill(true)
    this.process = null
  }

  private activation() {
    return this.deps.registry.get(this.pluginId)?.manifest.companion?.activation
  }

  /** Each call is a fresh launch: its own tmp folder, never one a stop elsewhere might clear. */
  private paths(record: InstalledPluginRecord): CompanionPaths {
    return {
      package: this.deps.registry.packageDirectory(record),
      data: path.join(this.deps.dataRoot, this.pluginId),
      tmp: path.join(this.deps.tmpRoot, this.pluginId, randomUUID()),
    }
  }

  private async ensureRunning(): Promise<Peer<CompanionContract>> {
    // A start must never overlap the stop it is waiting out, nor run while the plugin's
    // record is being disabled, replaced or removed underneath it (see PluginRegistry.withLock).
    if (this.stopping) await this.stopping
    await this.deps.registry.whenUnlocked(this.pluginId)
    if (this.state === "running" && this.peer) return this.peer
    if (this.state === "failed")
      throw new RpcError(
        "UNAVAILABLE",
        `The companion stopped after repeated failures (${this.lastError ?? "unknown"}). Restart it from Plugins.`
      )
    this.starting ??= this.start().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async start(): Promise<Peer<CompanionContract>> {
    if (this.state === "backoff" && this.retryAt !== null)
      await delay(Math.max(0, this.retryAt - Date.now()))
    const record = this.deps.registry.requireEnabled(this.pluginId)
    const companion = record.manifest.companion
    if (!companion)
      throw new RpcError(
        "NOT_FOUND",
        `${record.manifest.name} has no companion.`
      )
    this.setState("starting")
    let launched: CompanionProcess | null = null
    try {
      const paths = this.paths(record)
      const entry = companionEntry(record.manifest, this.deps.platform)
      if (!entry) throw new Error("the manifest declares no companion program")
      // Only the exact bytes reviewed at install may run.
      await this.deps.registry.readVerified(record, entry, MAX_EXECUTABLE_BYTES)
      await mkdir(paths.data, { recursive: true })
      // This launch gets its own fresh tmp folder (see paths()); clearing the plugin's whole
      // tmp root first also sweeps up a crashed launch's folder, which nothing else does.
      await rm(path.join(this.deps.tmpRoot, this.pluginId), {
        recursive: true,
        force: true,
      })
      await mkdir(paths.tmp, { recursive: true })
      const program = this.deps.registry.filePath(record, entry)
      const env = companionEnvironment(record, paths)
      launched =
        companion.runtime === "node"
          ? startNode(
              program,
              companion.args,
              {
                cwd: paths.data,
                env,
                name: `OpenSpindle plugin ${record.id}`,
                tmp: paths.tmp,
              },
              this.logs
            )
          : startNative(
              program,
              companion.args,
              { cwd: paths.data, env, tmp: paths.tmp },
              this.logs
            )
      this.process = launched
      const current = launched
      void current.exited.then((description) =>
        this.exited(current, description)
      )
      const peer = createEndpoint<CompanionHostContract, CompanionContract>({
        transport: launched.transport,
        remote: companionContract,
        serve: {
          contract: companionHostContract,
          handlers: this.hostHandlers(record),
          guard: createCapabilityGuard(
            heldRequirements(record.grants, ["companion"])
          ),
        },
        // A closed channel ends the companion's usefulness, even before the process exits.
        onClose: (reason) =>
          this.exited(current, `closed its channel (${reason ?? "no reason"})`),
      })
      this.peer = peer
      const initialized = await peer.call(
        "openspindle.initialize",
        {
          protocol: COMPANION_PROTOCOL,
          api: { version: PLUGIN_API.version, revision: PLUGIN_API.revision },
          plugin: { id: record.id, version: record.version },
          grants: record.grants,
          settings: record.settings,
          paths,
          platform: this.deps.platform,
        },
        { timeoutMs: HANDSHAKE_TIMEOUT_MS }
      )
      const health = await peer.call("health", undefined, {
        timeoutMs: HANDSHAKE_TIMEOUT_MS,
      })
      // Stopped (disabled, removed, updated) while the handshake was running.
      if (this.process !== launched)
        throw new RpcError("CANCELLED", "the companion was stopped")
      this.hasSetup = initialized.setup
      this.health = health
      this.logs.push({ level: "info", source: "host", message: "Started." })
      this.setState("running")
      this.scheduleIdle()
      return peer
    } catch (error) {
      if (!launched || this.process === launched)
        this.crashed(`could not start (${describe(error)})`)
      throw new RpcError(
        "UNAVAILABLE",
        `The companion could not start: ${describe(error)}`
      )
    }
  }

  private exited(current: CompanionProcess, description: string) {
    if (this.process !== current) {
      // Already handled when its channel closed; keep how the process ended.
      this.logs.push({
        level: "info",
        source: "host",
        message: `Companion process ${description}.`,
      })
      return
    }
    if (this.state === "stopping") return
    this.crashed(description)
  }

  /** Counts a crash; backs off exponentially, and gives up after the retry limit. */
  private crashed(reason: string) {
    this.lastError = reason
    this.logs.push({
      level: "error",
      source: "host",
      message: `Companion ${reason}.`,
    })
    const { process: ended, peer } = this
    this.process = null
    this.peer = null
    peer?.close(reason)
    ended?.kill(true)
    // Best effort: the next start also clears the whole plugin's tmp root (see start()).
    if (ended) void rm(ended.tmp, { recursive: true, force: true })
    const now = Date.now()
    this.crashes = [
      ...this.crashes.filter((at) => now - at < CRASH_WINDOW_MS),
      now,
    ]
    this.restarts += 1
    if (this.crashes.length >= MAX_CRASHES) {
      this.retryAt = null
      this.setState("failed")
      return
    }
    const retryAt =
      now + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (this.crashes.length - 1))
    this.retryAt = retryAt
    this.setState("backoff")
    // Open views that hold an on-view companion bring it back once the backoff ends.
    if (this.leases.size && this.activation() === "on-view") {
      this.clearRetry()
      this.retryTimer = setTimeout(
        () => this.ensureRunning().catch(() => undefined),
        retryAt - now
      )
    }
  }

  private hostHandlers(
    record: InstalledPluginRecord
  ): Handlers<CompanionHostContract> {
    return {
      methods: {
        "host.log": ({ level, message }) => {
          this.logs.push({ level, source: "companion", message })
          return null
        },
        "host.progress": (progress) => {
          this.broadcast({ kind: "progress", progress })
          return null
        },
        "host.emit": (event) => {
          this.broadcast({ kind: "emit", event })
          return null
        },
        "machine.snapshot": () =>
          machine(() => this.deps.gateway(record).snapshot()),
      },
      events: {},
    }
  }

  private broadcast(event: CompanionEvent) {
    for (const listener of this.leases) listener(event)
  }

  private setState(state: CompanionStatus["state"]) {
    this.state = state
    this.broadcast({ kind: "status", status: this.status() })
    this.deps.onStatus()
  }

  private changed() {
    this.broadcast({ kind: "status", status: this.status() })
    this.deps.onStatus()
  }

  private scheduleIdle() {
    this.clearIdle()
    if (this.state !== "running" || this.inFlight > 0 || this.leases.size > 0)
      return
    const seconds =
      this.deps.registry.get(this.pluginId)?.manifest.companion
        ?.idleShutdownSeconds ?? 300
    this.idleTimer = setTimeout(
      () => void this.stop("Stopped after being idle."),
      seconds * 1000
    )
  }

  private clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}

const STOPPED: CompanionStatus = {
  state: "stopped",
  health: null,
  setup: false,
  restarts: 0,
  lastError: null,
  retryAt: null,
}

/**
 * Companions only: the app installs, starts and stops them; they reach the app through
 * host.log/progress/emit and machine:read, never through ports or tokens.
 */
export class CompanionManager {
  private readonly supervisors = new Map<string, CompanionSupervisor>()

  constructor(private readonly deps: CompanionDeps) {}

  /** Null for plugins without a companion. */
  statusOf(record: InstalledPluginRecord): CompanionStatus | null {
    if (!record.manifest.companion) return null
    return this.supervisors.get(record.id)?.status() ?? STOPPED
  }

  status(pluginId: string): CompanionStatus {
    return this.supervisor(pluginId).status()
  }

  logs(pluginId: string): CompanionLogEntry[] {
    return this.supervisors.get(pluginId)?.logs.list() ?? []
  }

  invoke(
    pluginId: string,
    method: string,
    params: JsonValue | undefined,
    signal: AbortSignal
  ): Promise<JsonValue> {
    return this.supervisor(pluginId).invoke(method, params, signal)
  }

  setup(pluginId: string, signal: AbortSignal): Promise<CompanionHealth> {
    return this.supervisor(pluginId).setup(signal)
  }

  restart(pluginId: string): Promise<CompanionStatus> {
    return this.supervisor(pluginId).restart()
  }

  hold(
    pluginId: string,
    listener: (event: CompanionEvent) => void
  ): () => void {
    return this.supervisor(pluginId).hold(listener)
  }

  /** Before a plugin is disabled, updated or removed. */
  async stop(pluginId: string, note: string): Promise<void> {
    await this.supervisors.get(pluginId)?.stop(note)
  }

  /** On removal: the companion stops and its logs, private data and temporary files go. */
  async forget(pluginId: string): Promise<void> {
    await this.stop(pluginId, "Stopped: removed.")
    this.supervisors.delete(pluginId)
    await rm(path.join(this.deps.dataRoot, pluginId), {
      recursive: true,
      force: true,
    })
    await rm(path.join(this.deps.tmpRoot, pluginId), {
      recursive: true,
      force: true,
    })
  }

  /** Synchronous, for quitting: every companion process is ended now. */
  killAll() {
    for (const supervisor of this.supervisors.values()) supervisor.kill()
    this.supervisors.clear()
  }

  private supervisor(pluginId: string): CompanionSupervisor {
    const record = this.deps.registry.requireEnabled(pluginId)
    if (!record.manifest.companion)
      throw new RpcError(
        "NOT_FOUND",
        `${record.manifest.name} has no companion.`
      )
    let supervisor = this.supervisors.get(pluginId)
    if (!supervisor) {
      supervisor = new CompanionSupervisor(pluginId, this.deps)
      this.supervisors.set(pluginId, supervisor)
    }
    return supervisor
  }
}
