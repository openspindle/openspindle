import type { Telemetry } from "../contract/index.ts"
import { MachineError, abortError } from "./errors.ts"
import type { Clock, TimerHandle } from "./ports.ts"

export type StatusWait = {
  /** Only statuses newer than this sequence count; defaults to the current one. */
  readonly after?: number
  readonly timeoutMs: number
  readonly timeoutMessage: string
  readonly signal?: AbortSignal
  /** Ends the wait early with an error (for example an Alarm during a command). */
  readonly failWhen?: (telemetry: Telemetry) => MachineError | null
}

type Waiter = {
  readonly after: number
  readonly predicate: (telemetry: Telemetry) => boolean
  readonly failWhen?: (telemetry: Telemetry) => MachineError | null
  readonly settle: (result: Telemetry | Error) => void
}

/** Latest status with a monotonic sequence; operations wait on it instead of polling. */
export class TelemetryStore {
  telemetry: Telemetry | null = null
  sequence = 0
  private readonly waiters = new Set<Waiter>()
  private readonly clock: Clock
  private failure: Error | null = null

  constructor(clock: Clock) {
    this.clock = clock
  }

  /** Records a status; `observers` run before waiters so they see the same moment. */
  update(telemetry: Telemetry, observers?: () => void) {
    this.telemetry = telemetry
    this.sequence++
    observers?.()
    for (const waiter of [...this.waiters]) this.evaluate(waiter)
  }

  private evaluate(waiter: Waiter) {
    const telemetry = this.telemetry
    if (!telemetry || this.sequence <= waiter.after) return
    const failure = waiter.failWhen?.(telemetry)
    if (failure) waiter.settle(failure)
    else if (waiter.predicate(telemetry)) waiter.settle(telemetry)
  }

  waitFor(
    predicate: (telemetry: Telemetry) => boolean,
    options: StatusWait
  ): Promise<Telemetry> {
    return new Promise((resolve, reject) => {
      if (this.failure) {
        reject(this.failure)
        return
      }
      const signal = options.signal
      if (signal?.aborted) {
        reject(abortError(signal))
        return
      }
      let timer: TimerHandle | null = null
      const onAbort = () => {
        if (signal) waiter.settle(abortError(signal))
      }
      const waiter: Waiter = {
        after: options.after ?? this.sequence,
        predicate,
        ...(options.failWhen ? { failWhen: options.failWhen } : {}),
        settle: (result) => {
          if (!this.waiters.delete(waiter)) return
          this.clock.clearTimeout(timer)
          signal?.removeEventListener("abort", onAbort)
          if (result instanceof Error) reject(result)
          else resolve(result)
        },
      }
      this.waiters.add(waiter)
      // A status newer than `after` may already be here.
      this.evaluate(waiter)
      if (!this.waiters.has(waiter)) return
      timer = this.clock.setTimeout(
        () =>
          waiter.settle(new MachineError("timeout", options.timeoutMessage)),
        options.timeoutMs
      )
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  /** Rejects every waiter; used when the connection closes. */
  fail(error: Error) {
    this.failure = error
    for (const waiter of [...this.waiters]) waiter.settle(error)
  }
}
