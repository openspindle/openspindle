import { z } from "zod"
import {
  COMMAND_LABELS,
  ConnectRequestSchema,
  ConsoleLineSchema,
  SimulatedBedSchema,
  DisconnectRequestSchema,
  MachineCommandSchema,
  RUN_LIMITS,
  RunRequestSchema,
  WriteAnchorsRequestSchema,
  WriteConfigurationRequestSchema,
  disconnectedSnapshot,
  isJobActive,
  isSimulator,
  isTerminalJobPhase,
  machineId,
  programInfo,
  simulatedBedLine,
  programParts,
} from "../contract/index.ts"
import type {
  Activity,
  AnchorConfiguration,
  ConnectTarget,
  ConsoleEntry,
  HeightMap,
  JobState,
  MachineSnapshot,
  NetworkDevice,
  PreparedProgram,
  PrepareResult,
  RunRequest,
  Telemetry,
  WriteAnchorsResult,
  FirmwareConfiguration,
  WriteConfigurationResult,
} from "../contract/index.ts"
import { prepareResult } from "../firmware/adapter.ts"
import type {
  CompletionUpdate,
  FirmwareAdapter,
  Line,
  TransferProtocol,
} from "../firmware/adapter.ts"
import { DEFAULT_FIRMWARE } from "../firmware/registry.ts"
import { admit, availability } from "./admission.ts"
import type {
  Admission,
  AdmissionContext,
  AdmissionRequest,
} from "./admission.ts"
import { CameraFeed } from "./camera.ts"
import type { CameraEvent } from "./camera.ts"
import { DiscoveryService } from "./discovery.ts"
import { MachineError, cancelled } from "./errors.ts"
import type { PartedCompletion } from "./parted-completion.ts"
import { executeCommand } from "./operations/command.ts"
import { sendConsoleLine } from "./operations/console.ts"
import type { OperationContext } from "./operations/context.ts"
import {
  partPath,
  playNextPart,
  prepareAndStart,
} from "./operations/job-runner.ts"
import type { JobRunnerHooks } from "./operations/job-runner.ts"
import { readAnchorConfiguration, readHeightMap } from "./operations/reads.ts"
import {
  readFirmwareConfiguration,
  writeFirmwareConfiguration,
} from "./operations/configuration.ts"
import { writeAnchorConfiguration } from "./operations/writes.ts"
import type { MachinePorts } from "./ports.ts"
import { ProtocolTrace } from "./protocol-trace.ts"
import type { TraceEntry } from "./protocol-trace.ts"
import { MachineSession } from "./session.ts"
import { validSnapshot } from "./valid-snapshot.ts"

const STOP_CONFIRM_MS = 8000
const MAX_REMEMBERED_RUNS = 128
/** Reset: the frame leaves before the session closes; the firmware reboots 3 s after it. */
const RESET_SEND_MS = 300
const RESET_FIRST_ATTEMPT_MS = 5000
const RESET_RETRY_MS = 3000
const RESET_GIVE_UP_MS = 90_000
/** Prepared programs kept for their source: the Job tab checks its program whenever it opens. */
const PREPARED_KEPT = 4
/** Why leaving a running job waits for the user's confirmation, in the quit prompt's words. */
const LEAVING_JOB = {
  disconnect:
    "A job is running on the machine. Disconnecting ends OpenSpindle's tracking of the job, but the machine keeps running the program. Use Stop first to end it.",
  connect:
    "A job is running on the machine. Connecting to another device disconnects OpenSpindle from it, but the machine keeps running the program. Use Stop first to end it.",
} as const

type Foreground = Activity & { readonly controller: AbortController }

type Deferred = {
  readonly id: string
  readonly kind: "readAnchors" | "readHeightMap"
  readonly requestedAt: number
  readonly start: () => void
  readonly reject: (error: Error) => void
}

type ReadResults = {
  readonly readAnchors: AnchorConfiguration
  readonly readHeightMap: HeightMap
}
type ReadKind = keyof ReadResults

/** A kind's read, deferred or running, which every caller asking meanwhile shares. */
type SharedRead<TResult> = {
  /** Its entry in the deferred list while it waits for the machine. */
  deferred: Deferred | null
  running: boolean
  readonly callers: Set<{
    readonly resolve: (value: TResult) => void
    readonly reject: (error: unknown) => void
  }>
}

const PrepareInputSchema = z.strictObject({
  source: z.string().max(RUN_LIMITS.programBytes * 2),
})

function parse<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown
): z.output<TSchema> {
  const result = schema.safeParse(input)
  if (!result.success)
    throw new MachineError("invalid", z.prettifyError(result.error))
  return result.data
}

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

export type ControllerOptions = {
  readonly adapter?: FirmwareAdapter
  /**
   * Why there is no connection as this controller starts, which its snapshots report until the
   * next connect: the machine process it replaces stopped.
   */
  readonly error?: string | null
}

const FAST_PHASES: ReadonlySet<JobState["phase"]> = new Set([
  "starting",
  "finishing",
  "cleaning",
])

/**
 * The only owner of the machine connection (Facade). Every request passes the same
 * admission chain that produces snapshot availability; operations run one at a time,
 * reads during a program are deferred, and Stop preempts everything.
 */
export class MachineController {
  readonly discovery: DiscoveryService
  private readonly camera: CameraFeed
  private readonly trace: ProtocolTrace
  private readonly adapter: FirmwareAdapter
  private readonly ports: MachinePorts
  private session: MachineSession | null = null
  private lastError: string | null = null
  private activity: Foreground | null = null
  private deferred: Deferred[] = []
  /** Each kind's read while it is deferred or running; callers asking meanwhile join it. */
  private readonly reads: {
    readonly [TKind in ReadKind]: SharedRead<ReadResults[TKind]>
  } = {
    readAnchors: { deferred: null, running: false, callers: new Set() },
    readHeightMap: { deferred: null, running: false, callers: new Set() },
  }
  private job: JobState | null = null
  private tracker: PartedCompletion | null = null
  /** What the job's later parts play with, until it ends. */
  private running: {
    readonly request: RunRequest
    readonly program: PreparedProgram
    bedCleanBefore: boolean | null
  } | null = null
  /** The programs prepared last or being prepared, newest first, found by their source. */
  private preparedPrograms: {
    readonly source: string
    readonly result: Promise<PrepareResult>
  }[] = []
  /** Disconnect counts up: a connect still looking up the device's name then gives up. */
  private disconnects = 0
  private transfer: Pick<TransferProtocol, "cancel"> | null = null
  private readonly connectionIds = new WeakMap<MachineSession, string>()
  private lockout: string | null = null
  /** A reset is waiting for the machine to come back; connecting or disconnecting ends it. */
  private restart: { cancelled: boolean } | null = null
  private anchors: MachineSnapshot["anchors"] = {
    value: null,
    reading: false,
    error: null,
  }
  private anchorsAttempted = false
  private readonly usedRunIds = new Set<string>()
  private readonly listeners = new Set<(snapshot: MachineSnapshot) => void>()
  private current = disconnectedSnapshot()
  private dirty = true
  private notifyQueued = false
  /** The latest snapshot left out values the contract refused; the log has the run's first. */
  private refusing = false

  constructor(ports: MachinePorts, options: ControllerOptions = {}) {
    const adapter = options.adapter ?? DEFAULT_FIRMWARE
    this.ports = ports
    this.adapter = adapter
    this.lastError = options.error ?? null
    this.discovery = new DiscoveryService(ports.udp, adapter, ports.clock)
    this.camera = new CameraFeed(ports.camera, ports.clock)
    this.trace = new ProtocolTrace(ports.clock)
  }

  // ── Observation ────────────────────────────────────────────────────────

  snapshot(): MachineSnapshot {
    if (this.dirty) {
      this.current = this.checked(this.build(this.current.revision + 1))
      this.dirty = false
    }
    return this.current
  }

  /** The recent protocol exchange, across connections, for Help › Export Protocol Trace. */
  protocolTrace(): readonly TraceEntry[] {
    return this.trace.entries()
  }

  /** The machine console across connections: its backlog at once, then new entries. */
  watchConsole(listener: (entries: ConsoleEntry[]) => void): () => void {
    return this.trace.watchConsole(listener)
  }

  subscribe(listener: (snapshot: MachineSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  /** Live camera frames from the connected machine, shared across subscribers. */
  watchCamera(listener: (event: CameraEvent) => void): () => void {
    const device = this.session?.ready ? this.session.device : null
    const url = device ? this.adapter.cameraUrl(device) : null
    if (!url) {
      listener({ kind: "status", status: "error" })
      return () => {}
    }
    return this.camera.subscribe(url, listener)
  }

  // ── Connection ─────────────────────────────────────────────────────────

  discover(): Promise<NetworkDevice[]> {
    return this.discovery.discover()
  }

  /**
   * Connects to a device. A device's identity (fixture profile, height maps) is its model and
   * announced name, so a target given only by address takes the name the device announces
   * over the LAN; only a device that never announces is named by its address. While a job
   * runs, connecting to another device takes the user's confirmation. Disconnecting while the
   * name is looked up (up to 3 s) cancels the connect.
   */
  async connect(input: unknown): Promise<MachineSnapshot> {
    const { confirmed = false, ...target } = parse(ConnectRequestSchema, input)
    if (!this.connectedTo(target)) this.confirmLeavingJob(confirmed, "connect")
    this.endRestart()
    if (target.name !== undefined) return this.open(target, confirmed)
    const disconnects = this.disconnects
    const name = await this.discovery.nameOf(target)
    if (disconnects !== this.disconnects)
      throw new MachineError(
        "cancelled",
        "Disconnected before the device was connected."
      )
    return this.open(name === null ? target : { ...target, name }, confirmed)
  }

  private open(
    target: ConnectTarget,
    confirmed = false
  ): Promise<MachineSnapshot> {
    const existing = this.session
    if (this.connectedTo(target)) return Promise.resolve(this.snapshot())
    if (existing && !existing.ready)
      throw new MachineError(
        "busy",
        "A device connection is already in progress."
      )
    // Checked again: a job may have started while the device's name was looked up.
    this.confirmLeavingJob(confirmed, "connect")
    existing?.close(null)
    return new Promise((resolve, reject) => {
      let identified = false
      const session = new MachineSession(
        this.adapter,
        this.ports,
        target,
        {
          identified: () => {
            if (this.session !== session) return
            identified = true
            this.lastError = null
            this.lockout = null
            this.anchorsAttempted = false
            this.anchors = { value: null, reading: false, error: null }
            this.publish()
            resolve(this.snapshot())
          },
          status: (telemetry) => this.onStatus(session, telemetry),
          line: (line) => this.onLine(session, line),
          tick: (now) => this.onTick(session, now),
          closed: (error) => {
            this.onClosed(session, error)
            if (!identified)
              reject(
                new MachineError(
                  "connection-lost",
                  error ?? `Could not connect to ${target.host}:${target.port}.`
                )
              )
          },
        },
        this.trace
      )
      this.session = session
      this.lastError = null
      this.publish()
    })
  }

  /**
   * Ends the connection, and any connect still looking up its device's name; leaving a running
   * job takes the user's confirmation.
   */
  disconnect(input: unknown): MachineSnapshot {
    const { confirmed = false } = parse(DisconnectRequestSchema, input)
    this.confirmLeavingJob(confirmed, "disconnect")
    this.disconnects++
    this.endRestart()
    this.session?.close(null)
    this.lastError = null
    this.publish()
    return this.snapshot()
  }

  /** Whether the connection is with the device at this address. */
  private connectedTo(target: ConnectTarget): boolean {
    const device = this.session?.ready ? this.session.device : null
    return device?.host === target.host && device.port === target.port
  }

  /**
   * Closing the session a job runs on never stops its program, and the app's Stop goes with
   * it, as when quitting: the request must say the user confirmed it.
   */
  private confirmLeavingJob(
    confirmed: boolean,
    request: keyof typeof LEAVING_JOB
  ) {
    if (confirmed || !this.session || !isJobActive(this.job)) return
    throw new MachineError("confirmation-required", LEAVING_JOB[request])
  }

  /**
   * Restarts the controller. `reset` reboots it a few seconds later and the connection does not
   * survive that, so the session ends here and the same device is connected again once it
   * answers. Never under a running program or an operation.
   */
  async reset(): Promise<MachineSnapshot> {
    const session = this.session
    const device = session?.ready ? session.device : null
    if (!session || !device)
      throw new MachineError("not-connected", "Connect a device first.")
    this.admitNow({ key: "reset" })
    this.trace.record("note", "Reset requested")
    session.send(this.adapter.restart)
    const restart = { cancelled: false }
    this.restart = restart
    this.publish()
    await this.delay(RESET_SEND_MS)
    session.close("The machine is restarting.")
    void this.reconnectAfterReset(
      { host: device.host, port: device.port, name: device.name },
      restart
    )
    return this.snapshot()
  }

  private async reconnectAfterReset(
    target: ConnectTarget,
    restart: { cancelled: boolean }
  ) {
    const giveUpAt = this.ports.clock.now() + RESET_GIVE_UP_MS
    await this.delay(RESET_FIRST_ATTEMPT_MS)
    while (!restart.cancelled && this.ports.clock.now() < giveUpAt) {
      try {
        await this.open(target)
        break
      } catch {
        await this.delay(RESET_RETRY_MS)
      }
    }
    if (restart.cancelled) return
    this.restart = null
    if (!this.session?.ready)
      this.lastError =
        "The machine did not come back after the reset. Connect again once it is on."
    this.publish()
  }

  private endRestart() {
    if (!this.restart) return
    this.restart.cancelled = true
    this.restart = null
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      this.ports.clock.setTimeout(resolve, milliseconds)
    })
  }

  // ── Commands ───────────────────────────────────────────────────────────

  async execute(
    input: unknown,
    signal?: AbortSignal
  ): Promise<MachineSnapshot> {
    const command = parse(MachineCommandSchema, input)
    this.admitNow({ key: command.type, command })
    if (
      (command.type === "lightBrightness" ||
        command.type === "lightOffWhenIdle") &&
      (!this.session ||
        command.connectionId !== this.connectionId(this.session))
    )
      throw new MachineError(
        "refused",
        command.type === "lightBrightness"
          ? "The device connection changed. Adjust the work light brightness again."
          : "The device connection changed. No automatic work light off command was sent."
      )
    if (command.type === "pause") this.tracker?.pauseRequested()
    await this.operate("command", COMMAND_LABELS[command.type], (context) =>
      executeCommand(
        context,
        command,
        command.type === "lightOffWhenIdle" ? signal : undefined
      )
    )
    return this.snapshot()
  }

  /** Sends a line typed in the console, admitted like any command; the console shows the reply. */
  async sendConsoleLine(input: unknown): Promise<MachineSnapshot> {
    const line = parse(ConsoleLineSchema, input)
    this.admitNow({ key: "console" })
    await this.operate("command", "Console command", (context) =>
      sendConsoleLine(context, line)
    )
    return this.snapshot()
  }

  /**
   * Tells the simulator what the plate positions on its bed, as a console line while idle; a
   * machine is never sent one.
   */
  async simulateBed(input: unknown): Promise<MachineSnapshot> {
    const bed = parse(SimulatedBedSchema, input)
    const device = this.session?.device
    if (!device || !isSimulator(device))
      throw new MachineError("refused", "Only the simulator takes a bed.")
    this.admitNow({ key: "console" })
    await this.operate("command", "Simulated bed", (context) =>
      sendConsoleLine(context, simulatedBedLine(bed))
    )
    return this.snapshot()
  }

  /** Preempts everything: transfer cancel, operations, deferred reads, then the halt. */
  async stop(): Promise<MachineSnapshot> {
    const session = this.session
    if (!session?.ready)
      throw new MachineError("not-connected", "Connect a device first.")
    for (const frame of this.transfer?.cancel() ?? []) session.send(frame)
    this.activity?.controller.abort(
      new MachineError("cancelled", "Interrupted by Stop.")
    )
    for (const entry of this.deferred.splice(0))
      entry.reject(new MachineError("cancelled", "Cancelled by Stop."))
    this.tracker?.stopRequested()
    this.trace.record("note", "Stop requested")
    const after = session.store.sequence
    session.send(this.adapter.halt)
    const activity = this.begin("stop", "Stop")
    const releaseBoost = session.boostPolling()
    try {
      session.requestStatus(true)
      await session.store.waitFor((telemetry) => telemetry.state === "Alarm", {
        after,
        timeoutMs: STOP_CONFIRM_MS,
        timeoutMessage: "The machine did not confirm Stop.",
      })
      this.lockout = null
    } catch (error) {
      if (error instanceof MachineError && error.code === "timeout") {
        this.lockout =
          "The machine did not confirm Stop. Check the machine; Stop remains available."
        throw new MachineError("unverified", this.lockout)
      }
      throw error
    } finally {
      releaseBoost()
      this.end(activity)
    }
    return this.snapshot()
  }

  // ── Jobs ───────────────────────────────────────────────────────────────

  /** The normalized program this firmware would execute, or why it cannot. */
  prepare(input: unknown): Promise<PrepareResult> {
    const { source } = parse(PrepareInputSchema, input)
    return this.preparedFor(source)
  }

  /**
   * Prepares a source once, on the host's program preparer: a long program takes most of a
   * second, which on this loop would hold up status polling and Stop. Callers asking while it
   * prepares share it, the last few results are kept by their source, and the running job's
   * program is never prepared again while the job lasts.
   */
  private preparedFor(source: string): Promise<PrepareResult> {
    if (this.running?.request.source === source)
      return Promise.resolve({ ok: true, program: this.running.program })
    const kept = this.preparedPrograms.find((entry) => entry.source === source)
    const result = kept?.result ?? this.prepareProgram(source)
    this.preparedPrograms = [
      { source, result },
      ...this.preparedPrograms.filter((entry) => entry !== kept),
    ].slice(0, PREPARED_KEPT)
    // Preparing that failed is not the program's answer: the next request tries again.
    if (!kept)
      result.catch(() => {
        this.preparedPrograms = this.preparedPrograms.filter(
          (entry) => entry.result !== result
        )
      })
    return result
  }

  private async prepareProgram(source: string): Promise<PrepareResult> {
    const { programs } = this.ports
    if (programs) return programs.prepare(this.adapter.id, source)
    return prepareResult(this.adapter, source)
  }

  async run(input: unknown): Promise<MachineSnapshot> {
    const request = parse(RunRequestSchema, input)
    this.refuseUsedRun(request.id)
    // Refused at once when the machine would not take it, before the program is prepared.
    this.admitNow({ key: "run" })
    let prepared: PrepareResult
    try {
      prepared = await this.preparedFor(request.source)
    } catch (error) {
      throw new MachineError("invalid", message(error, "Invalid NC program."))
    }
    if (!prepared.ok) throw new MachineError("invalid", prepared.error)
    // Asked again: other requests, and the machine, went on while the program was prepared.
    this.refuseUsedRun(request.id)
    this.admitNow({ key: "run" })
    const program = prepared.program
    this.rememberRun(request.id)
    const now = this.ports.clock.now()
    const parts = programParts(program)
    this.job = {
      id: request.id,
      name: request.name,
      path: partPath(this.adapter, request.id, 0, parts.length),
      phase: "preparing",
      program: programInfo(program),
      part: 0,
      transfer: {
        uploadedBytes: 0,
        verifiedBytes: 0,
        totalBytes: parts[0].bytes,
      },
      progress: null,
      resumedLine: null,
      wait: null,
      faults: [],
      measurements: [],
      overdue: false,
      bedClean: null,
      error: null,
      startedAt: now,
      endedAt: null,
    }
    this.running = { request, program, bedCleanBefore: null }
    this.publish()
    try {
      await this.operate("run", `Starting ${request.name}`, (context) =>
        prepareAndStart(context, request, program, this.jobHooks())
      )
    } catch (error) {
      this.failJob(error)
      throw error
    }
    return this.snapshot()
  }

  private jobHooks(): JobRunnerHooks {
    return {
      md5: this.ports.md5,
      update: (patch) => this.patchJob(patch),
      attach: (tracker) => {
        this.tracker = tracker
        if (this.session) this.session.fastPolling = true
      },
      transferring: (protocol) => {
        this.transfer = protocol
      },
      bedCleanBefore: (enabled) => {
        if (this.running) this.running.bedCleanBefore = enabled
      },
    }
  }

  /**
   * Plays the next part of a program sent as parts once the one before it completed, unless
   * another operation holds the machine: its end continues the job. The part goes to this one
   * start; if it does not start, the job ends and the part is never tried again.
   */
  private continueParts() {
    const tracker = this.tracker
    const running = this.running
    if (!tracker?.awaitingNext || !running || this.activity) return
    if (!this.session?.ready) return
    const index = tracker.claimNext()
    if (index === null) return
    const count = tracker.parts.length
    const failure = (error: unknown) =>
      `Part ${index + 1} of ${count} did not start: ${message(error, "it could not be played.")}`
    this.trace.record(
      "note",
      `Job ${running.request.id}: part ${index} of ${count} completed`
    )
    this.operate(
      "run",
      `Starting part ${index + 1} of ${count}`,
      async (context) => {
        try {
          await playNextPart(
            context,
            running.request,
            running.bedCleanBefore,
            tracker,
            index,
            this.jobHooks()
          )
        } catch (error) {
          // Settled before the operation ends, whose end looks for a part to start.
          tracker.failedToStart(failure(error))
          throw error
        }
      }
    ).catch((error: unknown) => {
      // The code decides how the job ends: Stop's cancellation is the tracker's to settle.
      this.failJob(
        error instanceof MachineError
          ? new MachineError(error.code, failure(error))
          : new Error(failure(error))
      )
    })
  }

  /** Clears a finished job from the snapshot. */
  dismissJob(): MachineSnapshot {
    if (this.job && isTerminalJobPhase(this.job.phase)) {
      this.job = null
      this.publish()
    }
    return this.snapshot()
  }

  // ── Reads ──────────────────────────────────────────────────────────────

  readAnchors(signal?: AbortSignal): Promise<AnchorConfiguration> {
    return this.read(
      "readAnchors",
      "Reading anchors",
      signal,
      async (context) => {
        this.anchors = { ...this.anchors, reading: true, error: null }
        this.publish()
        try {
          const value = await readAnchorConfiguration(context)
          this.anchors = { value, reading: false, error: null }
          return value
        } catch (error) {
          this.anchors = {
            value: null,
            reading: false,
            error: message(error, "Could not read device anchors."),
          }
          throw error
        }
      }
    )
  }

  readHeightMap(signal?: AbortSignal): Promise<HeightMap> {
    return this.read(
      "readHeightMap",
      "Reading the height map",
      signal,
      (context) => readHeightMap(context, machineId(context.session.device!))
    )
  }

  // ── Settings ───────────────────────────────────────────────────────────

  /**
   * Stores anchor positions in the machine's configuration and reads them back: never while a
   * program runs, and never retried. Once a setting of its own anchors was sent, a failure
   * leaves the stored anchors unknown until they are read again; a write of the anchors its user
   * added alone leaves what was read, as the next write reads their places again. The machine's
   * own moves use its own anchors after it restarts.
   */
  async writeAnchors(input: unknown): Promise<WriteAnchorsResult> {
    const request = parse(WriteAnchorsRequestSchema, input)
    // The chain refuses the write outright while a program runs; it never waits.
    this.admitNow({ key: "writeAnchors" })
    return this.operate("anchors", "Writing anchors", async (context) => {
      const progress = { sent: false }
      try {
        const value = await writeAnchorConfiguration(context, request, () => {
          progress.sent = true
        })
        this.anchors = { value, reading: false, error: null }
        return {
          anchors: value,
          afterRestart:
            !!request.anchors &&
            (this.adapter.anchors?.write?.afterRestart ?? false),
        }
      } catch (error) {
        if (progress.sent && request.anchors)
          this.anchors = {
            value: null,
            reading: false,
            error: `${message(error, "The anchors were not written.")} Read the anchors to see what the device stores.`,
          }
        throw error
      }
    })
  }

  private connectionId(session: MachineSession): string {
    let id = this.connectionIds.get(session)
    if (!id) {
      id = crypto.randomUUID()
      this.connectionIds.set(session, id)
    }
    return id
  }

  async readConfiguration(
    signal?: AbortSignal
  ): Promise<FirmwareConfiguration> {
    if (signal?.aborted) throw cancelled()
    this.admitNow({ key: "readConfiguration" })
    return this.operate("configuration", "Reading configuration", (context) =>
      readFirmwareConfiguration(
        {
          ...context,
          signal: signal
            ? AbortSignal.any([context.signal, signal])
            : context.signal,
        },
        {
          md5: this.ports.md5,
          operationSignal: context.signal,
          connectionId: this.connectionId(context.session),
          transferring: (protocol) => {
            this.transfer = protocol
          },
        }
      )
    )
  }

  async writeConfiguration(input: unknown): Promise<WriteConfigurationResult> {
    const request = parse(WriteConfigurationRequestSchema, input)
    this.admitNow({ key: "writeConfiguration" })
    if (
      !this.session ||
      request.connectionId !== this.connectionId(this.session)
    )
      throw new MachineError(
        "refused",
        "The device connection changed. Read its configuration before saving."
      )
    return this.operate(
      "configuration",
      "Saving configuration",
      async (context) => {
        const configuration = await writeFirmwareConfiguration(
          context,
          request,
          {
            md5: this.ports.md5,
            operationSignal: context.signal,
            connectionId: this.connectionId(context.session),
            transferring: (protocol) => {
              this.transfer = protocol
            },
          },
          () => {
            // Whole-file editing can change anchors too. A later anchor read must refresh them.
            this.anchors = { value: null, reading: false, error: null }
            this.anchorsAttempted = false
            this.publish()
          }
        )
        return {
          configuration,
          afterRestart: this.adapter.configuration?.afterRestart ?? false,
        }
      }
    )
  }

  dispose() {
    this.session?.close(null)
    this.discovery.dispose()
    this.camera.dispose()
    this.listeners.clear()
  }

  // ── Session events ─────────────────────────────────────────────────────

  private onStatus(session: MachineSession, telemetry: Telemetry) {
    if (session !== this.session) return
    if (this.tracker) this.applyTracker(this.tracker.status(telemetry))
    this.maybeReadAnchorsOnConnect()
    this.scheduleDeferred()
    this.publish()
  }

  private onLine(session: MachineSession, line: Line) {
    if (session !== this.session || !this.tracker?.streaming) return
    if (this.playsAnotherFile(line)) return
    this.applyTracker(this.tracker.line(line, session.store.telemetry))
  }

  private onTick(session: MachineSession, now: number) {
    if (session !== this.session || !this.tracker) return
    this.applyTracker(this.tracker.tick(now))
  }

  private onClosed(session: MachineSession, error: string | null) {
    if (session !== this.session) return
    this.session = null
    this.lastError = error
    this.lockout = null
    this.transfer = null
    if (this.tracker) this.applyTracker(this.tracker.disconnected())
    const lost = new MachineError(
      "connection-lost",
      error ?? "The device was disconnected."
    )
    this.activity?.controller.abort(lost)
    for (const entry of this.deferred.splice(0)) entry.reject(lost)
    this.anchors = { ...this.anchors, reading: false }
    this.publish()
  }

  // ── Job tracking ───────────────────────────────────────────────────────

  private patchJob(patch: Partial<JobState>) {
    if (!this.job) return
    this.job = { ...this.job, ...patch }
    this.publish()
  }

  private applyTracker(update: CompletionUpdate) {
    const job = this.job
    if (!job) return
    const terminal = isTerminalJobPhase(update.phase)
    if (update.phase !== job.phase)
      this.trace.record("note", `Job ${job.id}: ${job.phase} → ${update.phase}`)
    this.job = {
      ...job,
      phase: update.phase,
      part: this.tracker?.part ?? job.part,
      progress: update.progress,
      resumedLine: update.resumedLine,
      wait: update.wait,
      faults: [...update.faults],
      measurements: [...update.measurements],
      overdue: update.overdue,
      error: update.error ?? (update.phase === "starting" ? job.error : null),
      endedAt: terminal ? (job.endedAt ?? this.ports.clock.now()) : null,
    }
    if (this.session)
      this.session.fastPolling =
        !terminal && (FAST_PHASES.has(update.phase) || update.nearEnd)
    if (terminal) {
      this.tracker = null
      this.running = null
      this.scheduleDeferred()
    } else this.continueParts()
    this.publish()
  }

  private failJob(error: unknown) {
    const job = this.job
    if (!job || isTerminalJobPhase(job.phase)) return
    const cause = error instanceof MachineError ? error : null
    // After play the tracker keeps following the program: Stop or the machine settles it.
    if (
      this.tracker &&
      (cause?.code === "cancelled" || cause?.code === "unverified")
    ) {
      if (cause.code === "unverified")
        this.patchJob({ error: cause.message, overdue: true })
      return
    }
    this.tracker = null
    this.running = null
    if (this.session) this.session.fastPolling = false
    const stopped = cause?.code === "cancelled"
    this.trace.record(
      "note",
      `Job ${job.id}: ${job.phase} → ${stopped ? "stopped" : "failed"} (${message(error, "not started")})`
    )
    this.job = {
      ...job,
      phase: stopped ? "stopped" : "failed",
      error: stopped
        ? null
        : message(error, "The program could not be started."),
      endedAt: this.ports.clock.now(),
    }
    this.publish()
  }

  /**
   * A play names its file only by a checksum of the path, and the machine answers with the size
   * of the file it was given. Another size than the part's while it starts means another file
   * plays: the start fails with that reason, and the machine is stopped as by Stop.
   */
  private playsAnotherFile(line: Line): boolean {
    const size = this.adapter.job.playedFileSize(line.text)
    const tracker = this.tracker
    if (size === null || !tracker || this.job?.phase !== "starting")
      return false
    const { bytes } = tracker.parts[tracker.part]
    if (size === bytes) return false
    const count = tracker.parts.length
    const sent =
      count === 1 ? "the program" : `part ${tracker.part + 1} of ${count}`
    const error = new MachineError(
      "rejected",
      `The machine began playing a file of ${size} bytes instead of the ${bytes} bytes of ${sent}: it finds the file to play by a checksum of its name, so another file on its card may be running. OpenSpindle sent Stop; check the machine before running again.`
    )
    // A start still waiting for the part fails with this reason rather than Stop's.
    if (this.activity?.kind === "run") this.activity.controller.abort(error)
    this.failJob(error)
    // An unconfirmed Stop sets the lockout, which the snapshot shows.
    this.stop().catch(() => {})
    return true
  }

  private refuseUsedRun(id: string) {
    if (this.usedRunIds.has(id))
      throw new MachineError(
        "invalid",
        "This Run request was already used. Review the machine and start a new Run; it is never replayed."
      )
  }

  private rememberRun(id: string) {
    this.usedRunIds.add(id)
    if (this.usedRunIds.size > MAX_REMEMBERED_RUNS)
      this.usedRunIds.delete(this.usedRunIds.values().next().value!)
  }

  // ── Operations and admission ───────────────────────────────────────────

  /**
   * A program streams while our job is active or the player reports progress. A halted
   * controller has always aborted its player: P in Alarm is only the abort snapshot.
   */
  private streaming(telemetry: Telemetry | null): boolean {
    if (this.tracker?.streaming) return true
    return telemetry?.job != null && telemetry.state !== "Alarm"
  }

  /** The firmware adapter defines when its configuration file can be read or saved. */
  private configurationAdmission(kind: "readAdmit" | "writeAdmit") {
    return this.adapter.configuration?.[kind] ?? null
  }

  private admissionContext(): AdmissionContext {
    const session = this.session?.ready ? this.session : null
    const telemetry = session?.store.telemetry ?? null
    return {
      connected: session !== null,
      identity: session?.identity ?? null,
      telemetry,
      now: this.ports.clock.now(),
      activity: this.activity,
      lockout: this.lockout,
      streaming: this.streaming(telemetry),
      job: this.job,
      rules: this.adapter.rules,
      readAnchors: this.adapter.anchors?.admit ?? null,
      writeAnchors: this.adapter.anchors?.write
        ? this.adapter.anchors.admit
        : null,
      readConfiguration: this.configurationAdmission("readAdmit"),
      writeConfiguration: this.configurationAdmission("writeAdmit"),
      limits: this.adapter.limits,
    }
  }

  /** Throws for a refusal; returns whether the request runs now or waits. */
  private admitNow(request: AdmissionRequest): "allow" | "defer" {
    const context = this.admissionContext()
    const admission: Admission = admit(request, context)
    if (admission.verdict === "refuse") {
      if (!context.connected)
        throw new MachineError("not-connected", admission.reason)
      throw new MachineError(
        context.activity ? "busy" : "refused",
        admission.reason
      )
    }
    return admission.verdict
  }

  private begin(kind: Activity["kind"], label: string): Foreground {
    const activity: Foreground = {
      kind,
      label,
      startedAt: this.ports.clock.now(),
      controller: new AbortController(),
    }
    this.activity = activity
    this.publish()
    return activity
  }

  private end(activity: Foreground) {
    if (this.activity === activity) this.activity = null
    this.publish()
    // A job waiting for its next part comes before deferred reads.
    this.continueParts()
    this.scheduleDeferred()
  }

  private async operate<TResult>(
    kind: Activity["kind"],
    label: string,
    work: (context: OperationContext) => Promise<TResult>
  ): Promise<TResult> {
    const session = this.session
    if (!session?.ready)
      throw new MachineError("not-connected", "Connect a device first.")
    const activity = this.begin(kind, label)
    try {
      return await work({
        session,
        adapter: this.adapter,
        clock: this.ports.clock,
        signal: activity.controller.signal,
        streaming: () => this.streaming(session.store.telemetry),
        admit: (request, telemetry) =>
          admit(request, {
            ...this.admissionContext(),
            activity: null,
            telemetry,
            streaming: this.streaming(telemetry),
          }),
      })
    } finally {
      this.end(activity)
    }
  }

  /**
   * Runs a read now, or defers it while a program runs. A caller asking while a read of its
   * kind is deferred or running joins it, so one read answers everyone waiting.
   */
  private read<TKind extends ReadKind>(
    key: TKind,
    label: string,
    signal: AbortSignal | undefined,
    work: (context: OperationContext) => Promise<ReadResults[TKind]>
  ): Promise<ReadResults[TKind]> {
    if (signal?.aborted) return Promise.reject(cancelled())
    const read = this.reads[key]
    // Joining a read that runs sends nothing, so it needs no admission.
    if (read.running) return this.joinRead(read, signal)
    let verdict: "allow" | "defer"
    try {
      verdict = this.admitNow({ key })
    } catch (error) {
      return Promise.reject(error)
    }
    if (verdict === "allow") this.runRead(key, read, label, work)
    else if (!read.deferred) {
      read.deferred = {
        id: crypto.randomUUID(),
        kind: key,
        requestedAt: this.ports.clock.now(),
        start: () => this.runRead(key, read, label, work),
        reject: (error) => {
          for (const caller of this.endRead(read)) caller.reject(error)
        },
      }
      this.deferred.push(read.deferred)
      this.publish()
    }
    return this.joinRead(read, signal)
  }

  /** Runs a kind's read now, taking it out of the deferred list if it waited there. */
  private runRead<TKind extends ReadKind>(
    key: TKind,
    read: SharedRead<ReadResults[TKind]>,
    label: string,
    work: (context: OperationContext) => Promise<ReadResults[TKind]>
  ) {
    const waited = read.deferred
    if (waited) this.deferred = this.deferred.filter((item) => item !== waited)
    read.deferred = null
    read.running = true
    this.operate(
      key === "readAnchors" ? "anchors" : "heightMap",
      label,
      work
    ).then(
      (value) => {
        for (const caller of this.endRead(read)) caller.resolve(value)
      },
      (error: unknown) => {
        for (const caller of this.endRead(read)) caller.reject(error)
      }
    )
  }

  /**
   * Waits on a kind's read. The signal withdraws only this caller; a deferred read that every
   * caller left leaves the deferred list.
   */
  private joinRead<TResult>(
    read: SharedRead<TResult>,
    signal: AbortSignal | undefined
  ): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      const onAbort = () => {
        read.callers.delete(caller)
        const waiting = read.deferred
        if (!waiting) {
          reject(cancelled())
          return
        }
        if (!read.callers.size) {
          this.deferred = this.deferred.filter((item) => item !== waiting)
          this.endRead(read)
          this.publish()
        }
        reject(cancelled("The deferred read was cancelled."))
      }
      const caller = {
        resolve: (value: TResult) => {
          signal?.removeEventListener("abort", onAbort)
          resolve(value)
        },
        reject: (error: unknown) => {
          signal?.removeEventListener("abort", onAbort)
          reject(error)
        },
      }
      read.callers.add(caller)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  /** Ends a kind's read and hands back the callers still waiting on it. */
  private endRead<TResult>(read: SharedRead<TResult>) {
    read.deferred = null
    read.running = false
    const callers = [...read.callers]
    read.callers.clear()
    return callers
  }

  /** Starts the oldest deferred read once the machine admits it. */
  private scheduleDeferred() {
    const next = this.deferred.at(0)
    if (!next || this.activity || !this.session?.ready) return
    const admission = admit({ key: next.kind }, this.admissionContext())
    if (admission.verdict === "defer") return
    this.deferred.shift()
    this.publish()
    if (admission.verdict === "refuse") {
      next.reject(new MachineError("refused", admission.reason))
      this.scheduleDeferred()
      return
    }
    next.start()
  }

  /** Each connection reads the firmware anchors once, when the machine first allows it. */
  private maybeReadAnchorsOnConnect() {
    if (this.anchorsAttempted || this.activity || !this.session?.ready) return
    if (
      admit({ key: "readAnchors" }, this.admissionContext()).verdict !== "allow"
    )
      return
    this.anchorsAttempted = true
    this.readAnchors().catch(() => {})
  }

  // ── Snapshot ───────────────────────────────────────────────────────────

  private publish() {
    this.dirty = true
    if (this.notifyQueued || !this.listeners.size) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      const snapshot = this.snapshot()
      for (const listener of [...this.listeners]) listener(snapshot)
    })
  }

  /**
   * The snapshot as the contract takes it. The renderer drops one the contract refuses, and so
   * every later one while the value stays, so the value is left out (`validSnapshot`); the log
   * gets the contract's issues once per run of such snapshots.
   */
  private checked(snapshot: MachineSnapshot): MachineSnapshot {
    const checked = validSnapshot(snapshot)
    if (checked.error && !this.refusing)
      this.ports.log?.warn(
        "Leaving out machine snapshot values that do not match the contract",
        z.prettifyError(checked.error)
      )
    this.refusing = checked.error !== null
    return checked.snapshot
  }

  private build(revision: number): MachineSnapshot {
    const session = this.session
    const ready = session?.ready ? session : null
    const telemetry = ready?.store.telemetry ?? null
    const context = this.admissionContext()
    let status: MachineSnapshot["connection"]["status"] = "disconnected"
    if (ready) status = "connected"
    else if (session) status = "connecting"
    return {
      revision,
      connection: {
        id: ready ? this.connectionId(ready) : null,
        status,
        device: ready?.device ?? null,
        // Failed attempts while the machine restarts are expected, not errors.
        error: this.restart ? null : this.lastError,
        restarting: this.restart !== null,
      },
      features: ready?.identity
        ? {
            ...this.adapter.features(ready.identity, telemetry),
            anchors: this.adapter.anchors !== undefined,
            configuration: this.adapter.configuration !== undefined,
          }
        : null,
      telemetry,
      availability: availability(context),
      activity: this.activity
        ? {
            kind: this.activity.kind,
            label: this.activity.label,
            startedAt: this.activity.startedAt,
          }
        : null,
      deferred: this.deferred.map(({ id, kind, requestedAt }) => ({
        id,
        kind,
        requestedAt,
      })),
      job: this.job,
      anchors: this.anchors,
      lockout: this.lockout ? { reason: this.lockout } : null,
      limits: ready ? this.adapter.limits : null,
    }
  }
}
