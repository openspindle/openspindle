import { FAILURE_LINES, excerpt } from "../../firmware/adapter.ts"
import { MachineError } from "../errors.ts"
import { freshStatus } from "./context.ts"
import type { OperationContext } from "./context.ts"

const CLOCK_MS = 5000
/** How far the machine's clock may be from ours before it is set, seconds. */
const CLOCK_TOLERANCE_S = 10
/** Stray replies after the read are swallowed for this long. */
const DRAIN_MS = 200

/**
 * Sets the machine's clock to ours when it is more than `CLOCK_TOLERANCE_S` off, as Makera's own
 * apps do on connecting: the machine dates the files it writes by it. Returns whether it set it.
 */
export async function syncClock(context: OperationContext): Promise<boolean> {
  const { session, adapter, clock, signal } = context
  const machineClock = adapter.clock
  if (!machineClock)
    throw new MachineError("refused", "This machine has no clock to set.")
  const before = await freshStatus(
    context,
    "Timed out waiting for fresh device status. The clock was not read."
  )
  const refusal = machineClock.admit(before)
  if (refusal) throw new MachineError("refused", refusal)
  const reading = session.request<number>(
    [machineClock.query],
    (event) => {
      if (event.kind !== "line") return "ignored"
      const { kind, text } = event.line
      const seconds = machineClock.parse(text)
      if (seconds !== null) return { done: seconds }
      if (FAILURE_LINES.has(kind))
        return {
          fail: new MachineError(
            "rejected",
            `The device rejected the clock read: ${excerpt(text)}`
          ),
        }
      return "ignored"
    },
    {
      timeoutMs: CLOCK_MS,
      timeoutMessage: "Reading the device's clock timed out.",
      signal,
    }
  )
  const machineSeconds = await reading
  session.drainFor(DRAIN_MS)
  const seconds = machineClock.seconds(clock.now())
  if (Math.abs(machineSeconds - seconds) <= CLOCK_TOLERANCE_S) return false
  session.send(machineClock.set(seconds))
  return true
}
