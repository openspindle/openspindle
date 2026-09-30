import { MachineError } from "../errors.ts"
import {
  expectAcknowledgement,
  freshStatus,
  requireAdmission,
} from "./context.ts"
import type { OperationContext } from "./context.ts"

/** How long a typed line waits for its acknowledgement; some shell commands send none. */
const CONSOLE_REPLY_MS = 5000
/** A late acknowledgement is swallowed for this long, so no later command takes it. */
const LATE_ACK_DRAIN_MS = 2000

/**
 * Sends a line typed in the console, admitted against fresh status like any command, and
 * waits for its acknowledgement; the machine's refusal rejects it. Its replies show in the
 * console. A line the firmware answers without an acknowledgement ends after a while.
 */
export async function sendConsoleLine(
  context: OperationContext,
  line: string
): Promise<void> {
  const { session, adapter } = context
  const before = await freshStatus(
    context,
    "Timed out waiting for fresh device status. The line was not sent."
  )
  requireAdmission(context, { key: "console" }, before)
  const reply = expectAcknowledgement(context, "the line", CONSOLE_REPLY_MS)
  session.send(adapter.consoleLine(line))
  session.requestStatus(true)
  try {
    await reply
  } catch (error) {
    if (!(error instanceof MachineError) || error.code !== "timeout")
      throw error
    session.drainFor(
      LATE_ACK_DRAIN_MS,
      (event) => event.kind === "line" && event.line.kind === "ack"
    )
  }
}
