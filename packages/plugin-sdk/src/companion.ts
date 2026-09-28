import { RpcError, createEndpoint } from "@openspindle/rpc"
import type { CallContext, Transport } from "@openspindle/rpc"
import { ndjsonTransport } from "@openspindle/rpc/ndjson"
import {
  COMPANION_PROTOCOL,
  companionContract,
  companionHostContract,
} from "@openspindle/plugin-core"
import type {
  CompanionContract,
  CompanionHealth,
  CompanionHostContract,
  CompanionInitialize,
  JsonValue,
  MachineSnapshot,
  Progress,
} from "@openspindle/plugin-core"
import { streamChannel } from "./node/streams.ts"

/** Throw an RpcError with a code (for example CONFLICT or INVALID_PARAMS) to pass it on to views. */
export { RpcError } from "@openspindle/rpc"
export type { RpcErrorCode } from "@openspindle/rpc"

/** What a companion may ask of the app; nothing here can move the machine. */
export type CompanionHost = {
  /** Adds a line to this plugin's log in the app. */
  log: (level: "debug" | "info" | "warn" | "error", message: string) => void
  /** Shows progress in the app. */
  progress: (progress: Progress) => void
  /** Delivers an event to this plugin's open views. */
  emit: (name: string, payload?: JsonValue) => void
  /** The machine's status; needs the machine:read grant. */
  machineSnapshot: () => Promise<MachineSnapshot>
}

export type CompanionContext = CallContext & {
  readonly host: CompanionHost
  /**
   * The plugin, its grants, what the user set for its settings (changing one restarts the
   * companion) and its private data and temporary folders.
   */
  readonly info: CompanionInitialize
}

export type CompanionMethod = (
  params: JsonValue | undefined,
  context: CompanionContext
) => JsonValue | undefined | Promise<JsonValue | undefined>

export type CompanionHandlers = {
  /** Plugin-defined methods, called by the plugin's views through companion.call. */
  readonly methods: Readonly<Record<string, CompanionMethod>>
  readonly initialize?: (
    info: CompanionInitialize,
    host: CompanionHost
  ) => void | Promise<void>
  /** Defaults to ready. */
  readonly health?: (
    context: CompanionContext
  ) => CompanionHealth | Promise<CompanionHealth>
  /** One-time preparation, such as installing a runtime into the data folder. */
  readonly setup?: (
    context: CompanionContext
  ) => CompanionHealth | Promise<CompanionHealth>
  readonly shutdown?: () => void | Promise<void>
}

type ParentPort = {
  postMessage: (message: unknown) => void
  on: (event: "message", listener: (event: { data: unknown }) => void) => void
  off: (event: "message", listener: (event: { data: unknown }) => void) => void
}

/** Present when the app started this companion as an Electron utility process. */
function parentPort(): ParentPort | null {
  const port: unknown = Reflect.get(process, "parentPort")
  if (!port || typeof port !== "object") return null
  const candidate = port as Partial<Record<keyof ParentPort, unknown>>
  return typeof candidate.postMessage === "function" &&
    typeof candidate.on === "function" &&
    typeof candidate.off === "function"
    ? (port as ParentPort)
    : null
}

function parentPortTransport(port: ParentPort): Transport {
  return {
    send: (message) => port.postMessage(message),
    listen(onMessage) {
      const receive = (event: { data: unknown }) => onMessage(event.data)
      port.on("message", receive)
      return () => port.off("message", receive)
    },
    close: () => {},
  }
}

/** Native-style companions speak NDJSON on stdio; stdout carries only the protocol. */
function stdioTransport(): Transport {
  const toStderr = console.error.bind(console)
  console.log = toStderr
  console.info = toStderr
  console.debug = toStderr
  return ndjsonTransport(
    streamChannel(process.stdin, process.stdout, "The app connection"),
    {
      onInvalidLine: (line) => toStderr(`Ignored a malformed message: ${line}`),
    }
  )
}

const READY: CompanionHealth = { status: "ready", message: null }

/**
 * Runs the companion side of the protocol: answers the app's lifecycle calls and routes
 * `invoke` to the plugin's methods. Returns the app-facing host for background work.
 */
export function serveCompanion(handlers: CompanionHandlers): CompanionHost {
  const port = parentPort()
  let info: CompanionInitialize | null = null

  const context = (signal: AbortSignal): CompanionContext => {
    if (!info)
      throw new RpcError("UNAVAILABLE", "The companion is not initialized yet.")
    return { signal, host, info }
  }

  const peer = createEndpoint<CompanionContract, CompanionHostContract>({
    transport: port ? parentPortTransport(port) : stdioTransport(),
    remote: companionHostContract,
    serve: {
      contract: companionContract,
      handlers: {
        methods: {
          "openspindle.initialize": async (params) => {
            info = params
            await handlers.initialize?.(params, host)
            return { protocol: COMPANION_PROTOCOL, setup: !!handlers.setup }
          },
          health: (_params, { signal }) =>
            handlers.health?.(context(signal)) ?? READY,
          setup: async (_params, { signal }) => {
            const current = context(signal)
            if (handlers.setup) return handlers.setup(current)
            return handlers.health?.(current) ?? READY
          },
          invoke: async ({ method, params }, { signal }) => {
            const handler = Object.hasOwn(handlers.methods, method)
              ? handlers.methods[method]
              : undefined
            if (!handler)
              throw new RpcError(
                "NOT_FOUND",
                `The companion has no method ${method}.`
              )
            return (await handler(params, context(signal))) ?? null
          },
          "openspindle.shutdown": async () => {
            await handlers.shutdown?.()
            setTimeout(() => process.exit(0), 50)
            return null
          },
        },
        events: {},
      },
    },
    // The app owns the lifetime: once its channel closes, there is nobody to serve.
    onClose: () => process.exit(0),
  })

  const notify = (send: () => Promise<unknown>) => {
    send().catch(() => undefined)
  }
  const host: CompanionHost = {
    log: (level, message) =>
      notify(() =>
        peer.call("host.log", { level, message: message.slice(0, 4000) })
      ),
    progress: (progress) => notify(() => peer.call("host.progress", progress)),
    emit: (name, payload = null) =>
      notify(() => peer.call("host.emit", { name, payload })),
    machineSnapshot: () => peer.call("machine.snapshot", undefined),
  }
  return host
}
