import {
  DIRECT_CLOCK_SKEW_MS,
  DIRECT_INPUT_TTL_MS,
  isFresh,
} from "../contract/index.ts"
import type {
  Availability,
  SimulatedJogSession,
  SimulatedJogSample,
  SimulatedJogReceipt,
  SimulatedJogAction,
} from "../contract/index.ts"
import type { SimulatorJogWireCommand } from "../firmware/makera/simulator-jog.ts"
import { FAILURE_LINES } from "../firmware/adapter.ts"
import { MachineError } from "./errors.ts"
import type { OperationContext } from "./operations/context.ts"
import type { TimerHandle } from "./ports.ts"

/** One controller owner; wire acknowledgements never hold the lease while verifying telemetry. */
export class SimulatedJogOwner {
  private readonly context: OperationContext
  readonly token: SimulatedJogSession
  readonly mode: "step" | "direct"
  private readonly onExpired: (reason: string) => void
  private readonly onChanged: () => void
  private timer: TimerHandle | null = null
  private sequence = 0
  private actionSequence = 0
  private active = false
  private pending: Promise<SimulatedJogReceipt> | null = null
  private exchangeAbort: AbortController | null = null
  private ended: Promise<void> | null = null
  private actionAbort: AbortController | null = null
  private actionKind: SimulatedJogAction["action"]["kind"] | null = null
  private latest: SimulatedJogSample | null = null
  private restAfter = -1
  private expectedSpindle = false
  private expectedTool: number | null = null
  constructor(
    context: OperationContext,
    token: SimulatedJogSession,
    mode: "step" | "direct",
    onExpired: (reason: string) => void,
    onChanged: () => void
  ) {
    this.context = context
    this.token = token
    this.mode = mode
    this.onExpired = onExpired
    this.onChanged = onChanged
  }
  async start() {
    await this.exchange(
      { kind: "begin", sessionId: this.token.sessionId, mode: this.mode },
      0,
      3000
    )
    this.active = true
    this.expectedTool = this.context.session.store.telemetry?.tool ?? null
    this.expireAt(this.context.clock.now() + DIRECT_INPUT_TTL_MS)
    this.onChanged()
  }
  private inputReason(
    input: SimulatedJogSession & { capturedAt: number }
  ): string | null {
    const now = this.context.clock.now()
    if (!this.active || this.ended)
      return "Controller session is no longer active"
    if (
      input.connectionId !== this.token.connectionId ||
      input.sessionId !== this.token.sessionId
    )
      return "Controller input belongs to another session"
    if (input.capturedAt > now + DIRECT_CLOCK_SKEW_MS)
      return `Controller input timestamp is ${input.capturedAt - now} ms ahead of the machine clock`
    if (input.capturedAt + DIRECT_INPUT_TTL_MS <= now)
      return "Controller input expired"
    return null
  }
  private telemetryReason(): string | null {
    const telemetry = this.context.session.store.telemetry
    if (
      !isFresh(telemetry, this.context.clock.now()) ||
      telemetry.estop !== false ||
      telemetry.job !== null ||
      !["Idle", "Run"].includes(telemetry.state) ||
      telemetry.tool !== this.expectedTool
    )
      return "Simulator status, E-stop, tool or job changed"
    if (
      this.actionKind !== "start" &&
      this.actionKind !== "stop" &&
      telemetry.spindleOn !== this.expectedSpindle
    )
      return "Simulator spindle state changed outside this controller session"
    return null
  }
  availability(kind: "step" | "spindle"): Availability {
    let reason =
      !this.active || this.ended
        ? "Arm simulator controller first."
        : this.telemetryReason()
    const { store } = this.context.session
    if (!reason && (this.pending || this.actionKind))
      reason = "A controller action is pending; press again after it finishes."
    if (
      !reason &&
      (store.sequence <= this.restAfter || store.telemetry?.feed !== 0)
    )
      reason = "Wait for controller motion to stop, then press again."
    if (
      !reason &&
      kind === "step" &&
      (this.mode !== "step" || this.latest?.suppress)
    )
      reason = "Release modifiers and select Step mode."
    if (!reason && kind === "spindle" && !this.latest?.spindleModifier)
      reason = "Hold X and wait for controller motion to stop."
    return { allowed: reason === null, deferred: false, reason }
  }
  async sample(input: SimulatedJogSample): Promise<SimulatedJogReceipt> {
    const refusal = this.inputReason(input) ?? this.telemetryReason()
    if (refusal) throw new MachineError("refused", `${refusal}. Arm again.`)
    if (input.sequence <= this.sequence)
      throw new MachineError(
        "refused",
        "Controller input sequence did not advance. Arm again."
      )
    if (this.pending)
      throw new MachineError("busy", "Controller input exchange is busy.")
    this.sequence = input.sequence
    const capturedAt = Math.min(input.capturedAt, this.context.clock.now())
    this.expireAt(capturedAt + DIRECT_INPUT_TTL_MS)
    const previous = this.latest
    const spindlePending =
      this.actionKind !== null && this.actionKind !== "step"
    const latest = {
      ...input,
      capturedAt,
      suppress: input.suppress || spindlePending,
      x: spindlePending ? 0 : input.x,
      y: spindlePending ? 0 : input.y,
      z: spindlePending ? 0 : input.z,
    }
    this.latest = latest
    if (input.suppress && this.actionKind === "step")
      this.actionAbort?.abort(
        new MachineError(
          "cancelled",
          "Step interrupted by modifier; press again after stopping."
        )
      )
    const stopping =
      (input.suppress && !previous?.suppress) ||
      (this.mode === "direct" &&
        Math.hypot(input.x, input.y, input.z) === 0 &&
        (!previous || Math.hypot(previous.x, previous.y, previous.z) > 0))
    // Prevent an action from seeing cached rest while the zero exchange is pending.
    if (stopping) this.restAfter = Number.MAX_SAFE_INTEGER
    const receipt = await this.exchange(
      { kind: "sample", sample: latest },
      input.sequence,
      DIRECT_INPUT_TTL_MS
    )
    if (stopping && this.active) {
      this.restAfter = this.context.session.store.sequence
      this.context.session.requestStatus(true)
      this.onChanged()
    }
    return receipt
  }
  async action(input: SimulatedJogAction): Promise<SimulatedJogReceipt> {
    const refusal = this.inputReason(input) ?? this.telemetryReason()
    if (refusal) throw new MachineError("refused", refusal)
    if (input.sequence <= this.actionSequence)
      throw new MachineError(
        "refused",
        "Controller action sequence did not advance."
      )
    this.actionSequence = input.sequence
    const action = input.action
    const entry = this.availability(action.kind === "step" ? "step" : "spindle")
    if (!entry.allowed)
      throw new MachineError(
        "busy",
        entry.reason ?? "Controller action unavailable"
      )
    if (
      action.kind !== "step" &&
      action.kind !== "stop" &&
      (action.rpm < this.context.adapter.limits.spindleRpmMin ||
        action.rpm > this.context.adapter.limits.spindleRpmMax)
    )
      throw new MachineError(
        "refused",
        "RPM is outside the connected control range."
      )
    const telemetry = this.context.session.store.telemetry!
    if (
      action.kind === "start" &&
      (!this.latest?.neutral ||
        this.latest.enableHeld ||
        telemetry.tool === null ||
        telemetry.tool < 1 ||
        telemetry.tool >= 1000)
    )
      throw new MachineError(
        "refused",
        "Centre both sticks, release LB and select a cutting tool before starting."
      )
    if (action.kind === "step" && !telemetry.machine)
      throw new MachineError("refused", "Simulator position is unknown.")
    const expected =
      action.kind === "step"
        ? telemetry.machine![action.axis.toLowerCase() as "x" | "y" | "z"] +
          action.distance
        : null
    const expectedSpindle =
      action.kind === "start" ||
      (action.kind !== "stop" && this.expectedSpindle)
    const abort = new AbortController()
    const relay = () => abort.abort(this.context.signal.reason)
    this.context.signal.addEventListener("abort", relay, { once: true })
    this.actionAbort = abort
    this.actionKind = action.kind
    this.onChanged()
    try {
      const receipt = await this.exchange(
        {
          kind: "action",
          input: {
            ...input,
            capturedAt: Math.min(input.capturedAt, this.context.clock.now()),
          },
        },
        input.sequence,
        DIRECT_INPUT_TTL_MS
      )
      const after = this.context.session.store.sequence
      this.context.session.requestStatus(true)
      await this.context.session.store.waitFor(
        (t) => {
          if (t.feed !== 0 || t.spindleOn !== expectedSpindle) return false
          if (action.kind === "step")
            return (
              !!t.machine &&
              Math.abs(
                t.machine[action.axis.toLowerCase() as "x" | "y" | "z"] -
                  expected!
              ) <= 0.002
            )
          if (action.kind === "stop") return t.spindleRpm === 0
          return (
            t.spindleTargetRpm === action.rpm &&
            t.spindleRpm === (expectedSpindle ? action.rpm : 0)
          )
        },
        {
          after,
          timeoutMs: action.kind === "step" ? 30000 : 3000,
          timeoutMessage:
            "Controller action acknowledgement received but effect was not confirmed.",
          signal: abort.signal,
          failWhen: (t) =>
            t.estop !== false ||
            t.tool !== this.expectedTool ||
            t.job !== null ||
            !["Idle", "Run"].includes(t.state)
              ? new MachineError(
                  "unverified",
                  "Simulator state changed during controller action verification."
                )
              : null,
        }
      )
      if (!this.active || this.ended)
        throw new MachineError(
          "cancelled",
          "Controller session ended during verification."
        )
      this.expectedSpindle = expectedSpindle
      return receipt
    } finally {
      this.context.signal.removeEventListener("abort", relay)
      if (this.actionAbort === abort) {
        this.actionAbort = null
        this.actionKind = null
        this.onChanged()
      }
    }
  }
  private expireAt(deadline: number) {
    this.context.clock.clearTimeout(this.timer)
    this.timer = this.context.clock.setTimeout(
      () => {
        this.active = false
        this.onExpired("Controller input expired — arm again")
      },
      Math.max(0, deadline - this.context.clock.now())
    )
  }
  end(): Promise<void> {
    if (this.ended) return this.ended
    this.active = false
    this.context.clock.clearTimeout(this.timer)
    this.onChanged()
    this.actionAbort?.abort(
      new MachineError("cancelled", "Controller session is ending.")
    )
    this.exchangeAbort?.abort(
      new MachineError("cancelled", "Controller session is ending.")
    )
    this.ended = this.finish()
    return this.ended
  }
  get ending() {
    return this.ended !== null
  }
  private async finish() {
    await this.pending?.catch(() => {})
    const { session } = this.context
    await this.exchange(
      { kind: "end", sessionId: this.token.sessionId },
      0,
      3000
    )
    const after = session.store.sequence
    session.requestStatus(true)
    await session.store.waitFor(
      (t) =>
        t.state === "Idle" &&
        t.feed === 0 &&
        t.spindleOn === false &&
        t.spindleRpm === 0,
      {
        after,
        timeoutMs: 3000,
        timeoutMessage: "Controller motion/spindle stop was not confirmed.",
        signal: this.context.signal,
      }
    )
  }
  invalidate() {
    this.active = false
    this.context.clock.clearTimeout(this.timer)
    this.actionAbort?.abort(
      new MachineError("cancelled", "Controller session invalidated.")
    )
    this.exchangeAbort?.abort(
      new MachineError("cancelled", "Controller session invalidated.")
    )
  }
  private exchange(
    command: SimulatorJogWireCommand,
    sequence: number,
    timeoutMs: number
  ): Promise<SimulatedJogReceipt> {
    if (this.pending)
      return Promise.reject(
        new MachineError("busy", "Controller exchange is busy.")
      )
    const promise = this.send(command, sequence, timeoutMs)
    this.pending = promise
    void promise
      .finally(() => {
        if (this.pending === promise) {
          this.pending = null
          this.onChanged()
        }
      })
      .catch(() => {})
    return promise
  }
  private async send(
    command: SimulatorJogWireCommand,
    sequence: number,
    timeoutMs: number
  ): Promise<SimulatedJogReceipt> {
    const protocol = this.context.adapter.simulatorJog
    if (!protocol)
      throw new MachineError(
        "refused",
        "Simulator controller protocol is unavailable."
      )
    const abort = new AbortController()
    this.exchangeAbort = abort
    const relay = () => abort.abort(this.context.signal.reason)
    if (this.context.signal.aborted) relay()
    this.context.signal.addEventListener("abort", relay, { once: true })
    try {
      return await this.context.session.request<SimulatedJogReceipt>(
        [protocol.frame(command)],
        (event) => {
          if (event.kind !== "line") return "ignored"
          const reply = protocol.reply(event.line.text)
          if (reply) {
            if (
              reply.sessionId !== this.token.sessionId ||
              reply.sequence !== sequence ||
              reply.kind !== command.kind
            )
              return "consumed"
            return reply.ok
              ? {
                  done: {
                    sessionId: reply.sessionId,
                    sequence: reply.sequence,
                    kind: reply.kind,
                  },
                }
              : {
                  fail: new MachineError(
                    "rejected",
                    reply.reason ?? "Simulator controller command refused."
                  ),
                }
          }
          if (FAILURE_LINES.has(event.line.kind))
            return { fail: new MachineError("rejected", event.line.text) }
          return "ignored"
        },
        {
          timeoutMs,
          timeoutMessage:
            "Simulator controller acknowledgement was not received.",
          signal: abort.signal,
        }
      )
    } finally {
      this.context.signal.removeEventListener("abort", relay)
      if (this.exchangeAbort === abort) this.exchangeAbort = null
    }
  }
}
