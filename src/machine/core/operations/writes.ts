import type {
  AnchorConfiguration,
  WriteAnchorsRequest,
} from "../../contract/index.ts"
import { FAILURE_LINES, excerpt } from "../../firmware/adapter.ts"
import { MachineError } from "../errors.ts"
import { freshStatus, requireAdmission } from "./context.ts"
import type { OperationContext } from "./context.ts"
import { drainAnchorReplies, readAnchorValues, replyText } from "./reads.ts"

const ANCHOR_SETTING_MS = 8000

/**
 * Stores anchor positions in the machine's configuration, one keyed setting at a time as the
 * machine confirms each, then reads every setting back: they must hold what was written. Nothing
 * is retried. `sending` is called before the first setting leaves; from then on, what the
 * machine stores is known only from a read.
 */
export async function writeAnchorConfiguration(
  context: OperationContext,
  request: WriteAnchorsRequest,
  sending: () => void
): Promise<AnchorConfiguration> {
  const { session, adapter, clock, signal } = context
  const { anchors } = adapter
  const write = anchors?.write
  if (!anchors || !write)
    throw new MachineError(
      "refused",
      "This machine's anchors cannot be changed."
    )
  let values: readonly number[]
  try {
    values = write.values(request.anchors)
  } catch (error) {
    throw new MachineError(
      "invalid",
      error instanceof Error
        ? error.message
        : "The anchor positions are invalid."
    )
  }
  const before = await freshStatus(
    context,
    "Timed out waiting for fresh device status. The anchors were not changed."
  )
  requireAdmission(context, { key: "writeAnchors" }, before)
  sending()
  try {
    for (const [index, key] of anchors.keys.entries()) {
      const current = session.store.telemetry
      if (current?.state !== "Idle" || current.job !== null)
        throw new MachineError(
          "cancelled",
          "Writing the anchors stopped because the device is no longer idle."
        )
      const value = values[index]
      await session.request<true>(
        [write.command(key, value)],
        (event) => {
          if (event.kind === "config-error")
            return {
              fail: new MachineError(
                "rejected",
                "Firmware could not store anchor settings."
              ),
            }
          const text = replyText(event)
          if (text === null) return "ignored"
          if (event.kind === "line" && FAILURE_LINES.has(event.line.kind))
            return {
              fail: new MachineError(
                "rejected",
                `Firmware rejected the anchor setting: ${excerpt(text)}`
              ),
            }
          const confirmed = write.confirm(text, key, value)
          if (confirmed === undefined)
            return anchors.isReply(text) ? "consumed" : "ignored"
          if (confirmed !== true)
            return { fail: new MachineError("rejected", confirmed) }
          return { done: true }
        },
        {
          timeoutMs: ANCHOR_SETTING_MS,
          timeoutMessage: `Timed out storing firmware setting ${key}.`,
          signal,
        }
      )
    }
  } finally {
    drainAnchorReplies(session, anchors)
  }
  const stored = await readAnchorValues(context, anchors)
  if (stored.some((value, index) => value !== values[index]))
    throw new MachineError(
      "unverified",
      "The device reads back other anchor positions than those written."
    )
  try {
    return anchors.build(stored, clock.now())
  } catch {
    throw new MachineError(
      "rejected",
      "Firmware anchor coordinates are invalid."
    )
  }
}
