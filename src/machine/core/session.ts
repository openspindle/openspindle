import type {
  ConnectTarget,
  ConnectedDevice,
  MachineState,
  Telemetry,
} from "../contract/index.ts"
import { ProtocolError } from "../firmware/adapter.ts"
import type {
  FirmwareAdapter,
  FirmwareDiagnostics,
  FirmwareEvent,
  FirmwareInterpreter,
  Identity,
  InboundFrame,
  Line,
  OutboundFrame,
} from "../firmware/adapter.ts"
import { MachineError, abortError } from "./errors.ts"
import {
  consoleReply,
  describeInbound,
  describeOutbound,
} from "./protocol-trace.ts"
import type { ProtocolTrace, Shown } from "./protocol-trace.ts"
import type {
  Clock,
  MachinePorts,
  TcpConnection,
  TimerHandle,
} from "./ports.ts"
import { TelemetryStore } from "./telemetry-store.ts"

const HANDSHAKE_MS = 8000
/** Polling this long without a status reply closes the connection. */
const STALE_MS = 5000
const POLL_MS = 1000
const FAST_POLL_MS = 250
/** A query unanswered this long may be repeated. */
const OUTSTANDING_MS = 1500
const COMMAND: Shown = { tone: "plain" }

/** Everything an operation may receive while it holds the reply lease. */
export type ReplyEvent =
  | { readonly kind: "line"; readonly line: Line }
  | { readonly kind: "config-line"; readonly text: string }
  | { readonly kind: "config-error" }
  | { readonly kind: "transfer"; readonly frame: InboundFrame }

/** A reply handler's verdict: finish with a value or error, or keep listening. */
export type ReplyVerdict<TResult> =
  { readonly done: TResult } | { readonly fail: Error } | "consumed" | "ignored"

export type ReplyOptions = {
  readonly timeoutMs: number
  readonly timeoutMessage: string
  readonly signal?: AbortSignal
  /** Each consumed event restarts the timeout (per-step deadlines). */
  readonly rearm?: boolean
}

type Lease = {
  handle: (event: ReplyEvent) => boolean
  fail: (error: Error) => void
}

export type SessionEvents = {
  readonly identified: (device: ConnectedDevice, identity: Identity) => void
  readonly status: (telemetry: Telemetry) => void
  /** Lines no lease claimed: job evidence, unsolicited reports. */
  readonly line: (line: Line) => void
  readonly tick: (now: number) => void
  readonly closed: (error: string | null) => void
}

/**
 * One TCP connection: handshake and identity, event routing, the reply lease,
 * status polling and the stale-status watchdog. It holds no policy.
 */
export class MachineSession {
  readonly store: TelemetryStore
  /** Latest diagnostic reply and its order, independent of cached ordinary status. */
  diagnostics: {
    readonly sequence: number
    readonly telemetry: FirmwareDiagnostics
  } | null = null
  identity: Identity | null = null
  /** State from the controller's model reply, rather than a bridge status report. */
  identityReplyState: MachineState | null = null
  device: ConnectedDevice | null = null
  closed = false
  /** The job monitor wants the fast rate (starting, finishing, cleaning). */
  fastPolling = false
  private boosts = 0
  private readonly adapter: FirmwareAdapter
  private readonly clock: Clock
  private readonly events: SessionEvents
  private readonly target: ConnectTarget
  private readonly interpreter: FirmwareInterpreter
  private readonly connection: TcpConnection
  private readonly trace: ProtocolTrace
  private lease: Lease | null = null
  private drain: {
    until: number
    accept: (event: ReplyEvent) => boolean
  } | null = null
  private pollTimer: TimerHandle | null = null
  private handshakeTimer: TimerHandle | null = null
  private suspensions = 0
  private outstandingSince: number | null = null
  /**
   * How long polling has gone without a status reply, in poll intervals rather than clock
   * time: while the host process does not run (a blocking call, the computer asleep), it
   * neither polls nor reads replies, so that time is no silence of the device's.
   */
  private silentMs = 0

  constructor(
    adapter: FirmwareAdapter,
    ports: MachinePorts,
    target: ConnectTarget,
    events: SessionEvents,
    trace: ProtocolTrace
  ) {
    this.adapter = adapter
    this.clock = ports.clock
    this.events = events
    this.target = target
    this.trace = trace
    trace.record("note", `Connecting to ${target.host}:${target.port}`)
    this.store = new TelemetryStore(ports.clock)
    this.interpreter = adapter.createInterpreter()
    this.handshakeTimer = this.clock.setTimeout(
      () => this.close("Timed out verifying the device."),
      HANDSHAKE_MS
    )
    this.connection = ports.tcp.connect(target.host, target.port, {
      open: () => {
        if (this.closed) return
        this.send(adapter.queries.identity)
        this.requestStatus(true)
        this.schedulePoll()
      },
      data: (bytes) => this.receive(bytes),
      closed: (error) =>
        this.close(error ?? "The device closed the connection."),
    })
  }

  get ready() {
    return !this.closed && this.device !== null
  }

  send(frame: OutboundFrame) {
    this.write(frame, true)
  }

  /** Diagnostics then status, so fresh diagnostics merge into the status that follows. */
  requestStatus(force = false) {
    if (this.closed || this.suspensions > 0) return
    const now = this.clock.now()
    if (
      !force &&
      this.outstandingSince !== null &&
      now - this.outstandingSince < OUTSTANDING_MS
    )
      return
    this.outstandingSince = now
    this.write(this.adapter.queries.diagnostics, false)
    this.write(this.adapter.queries.status, false)
  }

  /** Fast polling while an operation verifies its effect. */
  boostPolling(): () => void {
    this.boosts++
    let released = false
    return () => {
      if (released) return
      released = true
      this.boosts--
    }
  }

  /** Transfers own the link: no status queries until released. */
  suspendPolling(): () => void {
    this.suspensions++
    let released = false
    return () => {
      if (released) return
      released = true
      this.suspensions--
      // The transfer had no status traffic; restart the stale window.
      this.silentMs = 0
      this.outstandingSince = null
    }
  }

  /**
   * Takes the reply lease until the handler finishes. Only one operation may
   * listen for replies at a time; the lease also ends on timeout, abort or close.
   */
  expect<TResult>(
    handler: (event: ReplyEvent) => ReplyVerdict<TResult>,
    options: ReplyOptions
  ): Promise<TResult> {
    return this.listen(handler, options, [])
  }

  /**
   * Takes the reply lease, then sends the frames whose replies the handler waits for. Nothing is
   * sent without the lease, and a send that fails (the session closed) ends the lease with its
   * error, so the reply always settles through the promise returned.
   */
  request<TResult>(
    frames: readonly OutboundFrame[],
    handler: (event: ReplyEvent) => ReplyVerdict<TResult>,
    options: ReplyOptions
  ): Promise<TResult> {
    return this.listen(handler, options, frames)
  }

  private listen<TResult>(
    handler: (event: ReplyEvent) => ReplyVerdict<TResult>,
    options: ReplyOptions,
    frames: readonly OutboundFrame[]
  ): Promise<TResult> {
    if (this.lease)
      return Promise.reject(
        new MachineError(
          "busy",
          "Another device operation is waiting for replies."
        )
      )
    if (this.closed)
      return Promise.reject(
        new MachineError("connection-lost", "The device is disconnected.")
      )
    return new Promise<TResult>((resolve, reject) => {
      const signal = options.signal
      let timer: TimerHandle | null = null
      const arm = () => {
        this.clock.clearTimeout(timer)
        timer = this.clock.setTimeout(
          () => finish(new MachineError("timeout", options.timeoutMessage)),
          options.timeoutMs
        )
      }
      const onAbort = () => {
        if (signal) finish(abortError(signal))
      }
      const finish = (result: { done: TResult } | Error) => {
        if (this.lease !== lease) return
        this.lease = null
        this.clock.clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        if (result instanceof Error) reject(result)
        else resolve(result.done)
      }
      const lease: Lease = {
        handle: (event) => {
          const verdict = handler(event)
          if (verdict === "ignored") return false
          if (verdict === "consumed") {
            if (options.rearm) arm()
            return true
          }
          finish("fail" in verdict ? verdict.fail : verdict)
          return true
        },
        fail: (error) => finish(error),
      }
      if (signal?.aborted) {
        reject(abortError(signal))
        return
      }
      this.lease = lease
      arm()
      signal?.addEventListener("abort", onAbort, { once: true })
      try {
        for (const frame of frames) this.send(frame)
      } catch (error) {
        finish(
          error instanceof Error
            ? error
            : new MachineError("connection-lost", "The device is disconnected.")
        )
      }
    })
  }

  /** Swallows matching stray replies for a while (delayed acknowledgements, keyed config text). */
  drainFor(
    milliseconds: number,
    accept: (event: ReplyEvent) => boolean = () => true
  ) {
    this.drain = { until: this.clock.now() + milliseconds, accept }
  }

  close(error: string | null = null) {
    if (this.closed) return
    this.closed = true
    this.trace.record("note", `Disconnected: ${error ?? "closed by the app"}`)
    this.clock.clearTimeout(this.pollTimer)
    this.clock.clearTimeout(this.handshakeTimer)
    this.connection.destroy()
    const failure = new MachineError(
      "connection-lost",
      error ?? "The device was disconnected."
    )
    this.lease?.fail(failure)
    this.lease = null
    this.store.fail(failure)
    this.events.closed(error)
  }

  private isClosed() {
    return this.closed
  }

  /** Text frames are commands the console shows, unless they are polls; binary frames are data. */
  private write(frame: OutboundFrame, command: boolean) {
    if (this.closed)
      throw new MachineError("connection-lost", "The device is disconnected.")
    this.trace.record(
      "sent",
      describeOutbound(frame),
      command && typeof frame.payload === "string" ? COMMAND : undefined
    )
    this.connection.write(this.adapter.encode(frame))
  }

  private schedulePoll() {
    this.clock.clearTimeout(this.pollTimer)
    const interval =
      this.fastPolling || this.boosts > 0 ? FAST_POLL_MS : POLL_MS
    this.pollTimer = this.clock.setTimeout(() => {
      if (this.closed) return
      if (this.ready && this.suspensions === 0) {
        // A poll that comes late, after the process was held up, counts one interval: its
        // query goes out now, and replies that arrived meanwhile are read next.
        this.silentMs += interval
        if (this.silentMs >= STALE_MS) {
          this.close(
            "Device status stopped responding. The connection was closed."
          )
          return
        }
      }
      this.requestStatus()
      this.events.tick(this.clock.now())
      this.schedulePoll()
    }, interval)
  }

  private receive(bytes: Uint8Array) {
    if (this.closed) return
    let events: FirmwareEvent[]
    try {
      events = this.interpreter.push(bytes, this.clock.now())
    } catch (error) {
      this.close(
        error instanceof ProtocolError
          ? error.message
          : "Invalid device response."
      )
      return
    }
    for (const event of events) {
      // Routing may close the session part-way through a chunk.
      if (this.isClosed()) return
      this.route(event)
    }
  }

  private route(event: FirmwareEvent) {
    this.trace.record("received", describeInbound(event), consoleReply(event))
    switch (event.kind) {
      case "diagnostics":
        this.diagnostics = {
          sequence: (this.diagnostics?.sequence ?? 0) + 1,
          telemetry: event.telemetry,
        }
        return
      case "status":
        this.silentMs = 0
        this.outstandingSince = null
        if (!this.identify(event.identity)) return
        this.store.update(event.telemetry, () => {
          if (this.ready) this.events.status(event.telemetry)
        })
        return
      case "identity":
        if (this.identify(event.identity)) {
          this.identityReplyState = event.state
        }
        return
      case "line":
        if (!this.offer(event)) this.events.line(event.line)
        return
      default:
        this.offer(event)
    }
  }

  private offer(event: ReplyEvent): boolean {
    if (this.lease?.handle(event)) return true
    if (!this.drain) return false
    if (this.clock.now() > this.drain.until) {
      this.drain = null
      return false
    }
    return this.drain.accept(event)
  }

  private identify(identity: Identity): boolean {
    if (this.identity && this.identity.model !== identity.model) {
      this.close("The device reported inconsistent machine models.")
      return false
    }
    this.identity = identity
    if (!this.device) {
      this.clock.clearTimeout(this.handshakeTimer)
      this.device = {
        name: this.target.name ?? this.target.host,
        host: this.target.host,
        port: this.target.port,
        model: identity.model,
      }
      this.trace.record(
        "note",
        `Connected: ${this.device.name} (${identity.model})`
      )
      this.events.identified(this.device, identity)
    }
    return true
  }
}
