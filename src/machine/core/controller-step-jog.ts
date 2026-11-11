import {
  DIRECT_CLOCK_SKEW_MS,
  DIRECT_INPUT_TTL_MS,
  isFresh,
} from "../contract/index.ts"
import type {
  Availability,
  MachineCommand,
  SimulatedJogAction,
  SimulatedJogReceipt,
  SimulatedJogSample,
  SimulatedJogSession,
} from "../contract/index.ts"
import { FAILURE_LINES } from "../firmware/adapter.ts"
import { MachineError, abortError } from "./errors.ts"
import { executeCommand } from "./operations/command.ts"
import type { OperationContext } from "./operations/context.ts"
import type { TimerHandle } from "./ports.ts"
import { readAnchorConfiguration } from "./operations/reads.ts"

/** Stock-firmware controller ownership. Heartbeats are local; only checked finite commands go on the wire. */
export class ControllerStepJogOwner {
  private active = false
  private closed = false
  private timer: TimerHandle | null = null
  private sequence = 0
  private actionSequence = 0
  private latest: SimulatedJogSample | null = null
  private pending: AbortController | null = null
  private pendingKind: SimulatedJogAction["action"]["kind"] | null = null
  private tool: number | null = null
  targetRpm: number | null = null
  private bounds: ReturnType<
    NonNullable<OperationContext["adapter"]["controllerStepBounds"]>
  > = null
  private expectedSpindle = false
  private ended: Promise<void> | null = null
  private readonly inputAbort = new AbortController()
  private readonly context: OperationContext
  readonly token: SimulatedJogSession
  private readonly onExpired: (reason: string) => void
  private readonly onChanged: () => void

  constructor(
    context: OperationContext,
    token: SimulatedJogSession,
    onExpired: (reason: string) => void,
    onChanged: () => void
  ) {
    this.context = context
    this.token = token
    this.onExpired = onExpired
    this.onChanged = onChanged
  }

  async start() {
    const { session, adapter } = this.context
    const signal = AbortSignal.any([
      this.context.signal,
      this.inputAbort.signal,
    ])
    if (!adapter.controllerStepBounds)
      throw new MachineError(
        "refused",
        "This firmware has no physical controller jogging support."
      )
    this.bounds = adapter.controllerStepBounds(
      await readAnchorConfiguration({ ...this.context, signal })
    )
    if (!this.bounds)
      throw new MachineError(
        "refused",
        "Read valid anchors before arming the controller."
      )
    await session.waitForDrain(signal)
    let homed: boolean | null = null
    const ok = await session.request<boolean>(
      [adapter.job.homedQuery],
      (event) => {
        if (event.kind !== "line") return "ignored"
        const report = adapter.job.homed(event.line.text)
        if (report) {
          homed = report.homed
          return report.acknowledged ? { done: homed } : "consumed"
        }
        if (event.line.kind === "ack" && homed !== null) return { done: homed }
        if (FAILURE_LINES.has(event.line.kind))
          return { fail: new MachineError("rejected", event.line.text) }
        return "ignored"
      },
      {
        signal,
        timeoutMs: 3000,
        timeoutMessage:
          "Homed axes were not confirmed. Controller was not armed.",
      }
    )
    if (!ok)
      throw new MachineError(
        "refused",
        "Home the machine before arming the controller."
      )
    if (signal.aborted || this.closed) throw abortError(signal)
    const t = session.store.telemetry
    if (
      !isFresh(t, this.context.clock.now()) ||
      t.state !== "Idle" ||
      t.spindleOn !== false ||
      t.spindleRpm !== 0 ||
      t.estop !== false ||
      t.job !== null ||
      t.units !== "mm" ||
      t.compensation !== 0
    )
      throw new MachineError(
        "refused",
        "Arming requires fresh Idle status, metric mode, no height compensation, spindle off and E-stop released."
      )
    this.tool = t.tool
    this.targetRpm = t.spindleTargetRpm
    this.active = true
    this.renew(this.context.clock.now())
  }

  private reason() {
    if (!this.active || this.closed) return "Arm the controller first."
    const t = this.context.session.store.telemetry
    if (
      !isFresh(t, this.context.clock.now()) ||
      t.estop !== false ||
      t.job !== null ||
      t.tool !== this.tool ||
      !["Idle", "Run"].includes(t.state) ||
      t.units !== "mm" ||
      t.compensation !== 0
    )
      return "Machine status, tool, unit mode or compensation changed. Arm again."
    if (
      this.pendingKind !== "start" &&
      this.pendingKind !== "stop" &&
      t.spindleOn !== this.expectedSpindle
    )
      return "Spindle state changed outside the controller. Arm again."
    return null
  }

  private check(input: SimulatedJogSession & { capturedAt: number }) {
    const now = this.context.clock.now()
    if (
      input.connectionId !== this.token.connectionId ||
      input.sessionId !== this.token.sessionId ||
      input.capturedAt > now + DIRECT_CLOCK_SKEW_MS ||
      input.capturedAt + DIRECT_INPUT_TTL_MS <= now
    )
      throw new MachineError(
        "refused",
        "Controller input is stale or belongs to an earlier connection. Arm again."
      )
    const reason = this.reason()
    if (reason) throw new MachineError("refused", reason)
  }

  private renew(capturedAt: number) {
    this.context.clock.clearTimeout(this.timer)
    this.timer = this.context.clock.setTimeout(
      () => {
        this.active = false
        this.onExpired("Controller input expired — arm again")
      },
      Math.max(
        0,
        Math.min(capturedAt, this.context.clock.now()) +
          DIRECT_INPUT_TTL_MS -
          this.context.clock.now()
      )
    )
  }

  availability(kind: "step" | "spindle"): Availability {
    let reason = this.reason()
    const t = this.context.session.store.telemetry
    if (!reason && this.pending)
      reason = "A controller action is pending; press again after it finishes."
    if (!reason && t?.feed !== 0) reason = "Wait for motion to stop."
    if (!reason && kind === "step" && t?.state !== "Idle")
      reason = "Wait for Idle before jogging."
    if (
      !reason &&
      kind === "step" &&
      (!this.latest?.enableHeld || this.latest.suppress)
    )
      reason = "Hold LB and release modifiers to jog."
    if (!reason && kind === "step" && t?.spindleOn !== false)
      reason = "Stop the spindle before jogging."
    if (!reason && kind === "spindle" && !this.latest?.spindleModifier)
      reason = "Hold X and wait for motion to stop."
    return { allowed: reason === null, deferred: false, reason }
  }

  async sample(input: SimulatedJogSample): Promise<SimulatedJogReceipt> {
    this.check(input)
    if (input.sequence <= this.sequence)
      throw new MachineError("refused", "Controller sequence did not advance.")
    if (Math.hypot(input.x, input.y, input.z) !== 0)
      throw new MachineError(
        "refused",
        "Direct steering is unavailable on stock firmware; select Step."
      )
    this.sequence = input.sequence
    this.latest = input
    this.renew(input.capturedAt)
    if (input.suppress && this.pendingKind === "step") {
      this.active = false
      this.onExpired("Controller step interrupted by modifier — arm again")
    }
    this.onChanged()
    return {
      sessionId: this.token.sessionId,
      sequence: input.sequence,
      kind: "sample",
    }
  }

  async action(input: SimulatedJogAction): Promise<SimulatedJogReceipt> {
    this.check(input)
    if (input.sequence <= this.actionSequence)
      throw new MachineError(
        "refused",
        "Controller action sequence did not advance."
      )
    this.actionSequence = input.sequence
    const action = input.action
    const availability = this.availability(
      action.kind === "step" ? "step" : "spindle"
    )
    if (!availability.allowed)
      throw new MachineError("busy", availability.reason!)
    if (
      action.kind === "start" &&
      (!this.latest?.neutral || this.latest.enableHeld)
    )
      throw new MachineError(
        "refused",
        "Centre both sticks and release LB before starting the spindle."
      )
    const { limits } = this.context.adapter
    if (
      action.kind !== "step" &&
      action.kind !== "stop" &&
      (action.rpm < limits.spindleRpmMin || action.rpm > limits.spindleRpmMax)
    )
      throw new MachineError(
        "refused",
        "RPM is outside the connected machine's limits."
      )
    // Setting a target while off does not turn the spindle on.
    if (action.kind === "target" && !this.expectedSpindle) {
      this.targetRpm = action.rpm
      this.onChanged()
      return {
        sessionId: this.token.sessionId,
        sequence: input.sequence,
        kind: "action",
      }
    }
    let command: MachineCommand
    if (action.kind === "step")
      command = {
        type: "jog",
        axis: action.axis,
        distance: action.distance,
        speedScale: action.speedScale,
      }
    else if (action.kind === "stop") command = { type: "spindleStop" }
    else command = { type: "spindleStart", rpm: action.rpm }
    const abort = new AbortController()
    this.pending = abort
    this.pendingKind = action.kind
    this.onChanged()
    try {
      await executeCommand(
        {
          ...this.context,
          signal: AbortSignal.any([
            this.context.signal,
            this.inputAbort.signal,
            abort.signal,
          ]),
          onUnverifiedMotion: () => {
            if (this.context.session.ready)
              this.context.session.send(this.context.adapter.halt)
          },
          admit: (request, telemetry) => {
            const admitted = this.context.admit(request, telemetry)
            if (
              admitted.verdict !== "allow" ||
              request.key !== "jog" ||
              !("command" in request) ||
              request.command.type !== "jog"
            )
              return admitted
            const jog = request.command
            const axis = ["X", "Y", "Z"].indexOf(jog.axis)
            const position =
              telemetry.machine &&
              [telemetry.machine.x, telemetry.machine.y, telemetry.machine.z][
                axis
              ]
            if (position === null || !this.bounds)
              return {
                verdict: "refuse",
                reason:
                  "Machine position or controller travel bounds are unavailable.",
              }
            const end = position + jog.distance
            const min = this.bounds.min[axis]
            const max = this.bounds.max[axis]
            // An outside position may recover inward, never travel farther out.
            if (
              end < Math.min(position, min) - 0.0001 ||
              end > Math.max(position, max) + 0.0001
            )
              return {
                verdict: "refuse",
                reason:
                  "This step would exceed the modeled machine travel. Choose a smaller step or jog inward.",
              }
            return admitted
          },
        },
        command
      )
      if (!this.active || this.closed)
        throw new MachineError(
          "cancelled",
          "Controller action ended; no action was retried."
        )
      if (action.kind === "start") this.expectedSpindle = true
      if (action.kind === "stop") this.expectedSpindle = false
      if (action.kind === "target" || action.kind === "start")
        this.targetRpm = action.rpm
      return {
        sessionId: this.token.sessionId,
        sequence: input.sequence,
        kind: "action",
      }
    } finally {
      if (this.pending === abort) {
        this.pending = null
        this.pendingKind = null
        this.onChanged()
      }
    }
  }

  get ending() {
    return this.ended !== null
  }

  end(): Promise<void> {
    if (this.ended) return this.ended
    this.active = false
    this.closed = true
    this.context.clock.clearTimeout(this.timer)
    this.inputAbort.abort(new MachineError("cancelled", "Controller disarmed."))
    // Abort any awaiting preflight before deciding whether a halt is needed.
    const pending = this.pending !== null
    this.pending?.abort(new MachineError("cancelled", "Controller disarmed."))
    this.ended = this.finish(pending)
    return this.ended
  }

  private async finish(pending: boolean) {
    const { session, adapter, clock, signal } = this.context
    const t = session.store.telemetry
    if (
      !pending &&
      isFresh(t, clock.now()) &&
      t.state === "Idle" &&
      t.feed === 0 &&
      t.spindleOn === false &&
      t.spindleRpm === 0
    )
      return
    // Stock firmware has no verified jog cancel. Ctrl-X halts into Alarm and stops the spindle.
    const after = session.store.sequence
    session.send(adapter.halt)
    session.requestStatus(true)
    await session.store.waitFor(
      (status) =>
        status.state === "Alarm" &&
        status.spindleOn === false &&
        status.spindleRpm === 0,
      {
        after,
        signal,
        timeoutMs: 8000,
        timeoutMessage:
          "Controller stop was not confirmed. Check the machine before reconnecting.",
      }
    )
  }

  invalidate() {
    this.active = false
    this.closed = true
    this.context.clock.clearTimeout(this.timer)
    this.inputAbort.abort(
      new MachineError("cancelled", "Controller connection ended.")
    )
    this.pending?.abort(
      new MachineError("cancelled", "Controller connection ended.")
    )
  }
}
