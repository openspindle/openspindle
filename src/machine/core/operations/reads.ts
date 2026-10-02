import { HEIGHT_MAP_LIMITS } from "../../contract/index.ts"
import type {
  AnchorConfiguration,
  HeightMap,
  SwitchReport,
} from "../../contract/index.ts"
import { FAILURE_LINES, excerpt } from "../../firmware/adapter.ts"
import type { AddedSlot } from "../../firmware/adapter.ts"
import { MachineError } from "../errors.ts"
import type { ReplyEvent } from "../session.ts"
import { freshStatus, requireAdmission } from "./context.ts"
import type { OperationContext } from "./context.ts"

const ANCHOR_KEY_MS = 8000
const HEIGHT_MAP_MS = 8000
const SWITCHES_MS = 5000
/** Stray replies after a read are swallowed for this long. */
const DRAIN_MS = 200
/** A cancelled grid read may still be streaming rows. */
const CANCELLED_READ_DRAIN_MS = 2000

/** The machine's stored anchors, as its firmware adapter reads and writes them. */
export type AnchorSettings = NonNullable<OperationContext["adapter"]["anchors"]>

export const replyText = (event: ReplyEvent): string | null => {
  if (event.kind === "line") return event.line.text
  if (event.kind === "config-line") return event.text
  return null
}

/** Keeps the anchor settings' replies that arrive late away from later operations. */
export function drainAnchorReplies(
  session: OperationContext["session"],
  anchors: AnchorSettings
) {
  session.drainFor(
    DRAIN_MS,
    (event) =>
      event.kind === "config-line" ||
      (event.kind === "line" && anchors.isReply(event.line.text))
  )
}

/** The anchors the machine stores, read one keyed setting at a time. The configurator sends no acknowledgement. */
export async function readAnchorConfiguration(
  context: OperationContext
): Promise<AnchorConfiguration> {
  const { adapter, clock } = context
  const { anchors } = adapter
  if (!anchors)
    throw new MachineError("refused", "This machine does not store anchors.")
  const before = await freshStatus(
    context,
    "Timed out waiting for fresh device status. Anchors were not read."
  )
  requireAdmission(context, { key: "readAnchors" }, before)
  const values = await readAnchorValues(context, anchors)
  const slots = anchors.added
    ? await readAddedSlots(context, anchors)
    : undefined
  try {
    return withAdded(anchors.build(values, clock.now()), slots)
  } catch {
    throw new MachineError(
      "rejected",
      "Firmware anchor coordinates are invalid."
    )
  }
}

/** The values of the anchor settings, in the order of their keys, while the device stays idle. */
export async function readAnchorValues(
  context: OperationContext,
  anchors: AnchorSettings
): Promise<number[]> {
  const { session, signal } = context
  const values: number[] = []
  try {
    for (const key of anchors.keys) {
      const current = session.store.telemetry
      if (current?.state !== "Idle" || current.job !== null)
        throw new MachineError(
          "cancelled",
          "Anchor retrieval stopped because the device is no longer idle. Retry when it is idle."
        )
      const reply = session.request<number>(
        [anchors.query(key)],
        (event) => {
          if (event.kind === "config-error")
            return {
              fail: new MachineError(
                "rejected",
                "Firmware could not read anchor settings."
              ),
            }
          const text = replyText(event)
          if (text === null) return "ignored"
          if (event.kind === "line" && FAILURE_LINES.has(event.line.kind))
            return {
              fail: new MachineError(
                "rejected",
                `Firmware rejected anchor retrieval: ${excerpt(text)}`
              ),
            }
          const value = anchors.parse(text, key)
          if (value === undefined)
            return anchors.isReply(text) ? "consumed" : "ignored"
          if (value === null)
            return {
              fail: new MachineError(
                "rejected",
                `Firmware setting ${key} is unavailable or invalid.`
              ),
            }
          return { done: value }
        },
        {
          timeoutMs: ANCHOR_KEY_MS,
          timeoutMessage: `Timed out reading firmware setting ${key}.`,
          signal,
        }
      )
      values.push(await reply)
    }
  } finally {
    drainAnchorReplies(session, anchors)
  }
  return values
}

/** The anchors a machine's places hold, each with its place; the first of an id counts. */
export function withAdded(
  configuration: AnchorConfiguration,
  slots: readonly AddedSlot[] | undefined
): AnchorConfiguration {
  if (!slots) return configuration
  const added: NonNullable<AnchorConfiguration["added"]> = []
  for (const [slot, anchor] of slots.entries())
    if (
      anchor &&
      anchor !== "other" &&
      !added.some((item) => item.id === anchor.id)
    )
      added.push({ ...anchor, slot })
  return { ...configuration, added }
}

/**
 * What each place for anchors the user added holds, in order, up to the first that is not there
 * (or the adapter's limit), while the device stays idle.
 */
export async function readAddedSlots(
  context: OperationContext,
  anchors: AnchorSettings
): Promise<AddedSlot[]> {
  const { session, signal } = context
  const added = anchors.added
  if (!added) return []
  const slots: AddedSlot[] = []
  try {
    for (let slot = 0; slot < added.limit; slot += 1) {
      const current = session.store.telemetry
      if (current?.state !== "Idle" || current.job !== null)
        throw new MachineError(
          "cancelled",
          "Anchor retrieval stopped because the device is no longer idle. Retry when it is idle."
        )
      const held = await session.request<AddedSlot | "absent">(
        [added.query(slot)],
        (event) => {
          if (event.kind === "config-error")
            return {
              fail: new MachineError(
                "rejected",
                "Firmware could not read anchor settings."
              ),
            }
          const text = replyText(event)
          if (text === null) return "ignored"
          if (event.kind === "line" && FAILURE_LINES.has(event.line.kind))
            return {
              fail: new MachineError(
                "rejected",
                `Firmware rejected anchor retrieval: ${excerpt(text)}`
              ),
            }
          const value = added.parse(text, slot)
          if (value === undefined)
            return anchors.isReply(text) ? "consumed" : "ignored"
          return { done: value }
        },
        {
          timeoutMs: ANCHOR_KEY_MS,
          timeoutMessage: "Timed out reading the device's added anchors.",
          signal,
        }
      )
      if (held === "absent") break
      slots.push(held)
    }
  } finally {
    drainAnchorReplies(session, anchors)
  }
  return slots
}

/** Read-only grid display (M375.1), never the command that loads and enables compensation. */
export async function readHeightMap(
  context: OperationContext,
  deviceId: string
): Promise<HeightMap> {
  const { session, adapter, clock, signal } = context
  const before = await freshStatus(
    context,
    "Timed out waiting for fresh device status. No height-map request was sent."
  )
  requireAdmission(context, { key: "readHeightMap" }, before)
  let raw = ""
  const response = session.request<string>(
    [adapter.heightMap.query],
    (event) => {
      if (event.kind !== "line") return "ignored"
      const { kind, text } = event.line
      if (kind === "ack") return { done: `${raw}ok\n` }
      if (FAILURE_LINES.has(kind))
        return {
          fail: new MachineError(
            "rejected",
            `The device rejected the height-map read: ${excerpt(text)}`
          ),
        }
      if (raw.length + text.length + 1 > HEIGHT_MAP_LIMITS.responseBytes)
        return {
          fail: new MachineError(
            "rejected",
            "Height map response exceeded its size limit."
          ),
        }
      raw += `${text}\n`
      return "consumed"
    },
    {
      timeoutMs: HEIGHT_MAP_MS,
      timeoutMessage:
        "Height-map retrieval timed out. The request was not retried.",
      signal,
    }
  )
  let complete: string
  try {
    complete = await response
  } catch (error) {
    // Rows may still arrive; keep them (and the acknowledgement) away from later commands.
    session.drainFor(
      CANCELLED_READ_DRAIN_MS,
      (event) =>
        event.kind === "line" &&
        (event.line.kind === "info" || event.line.kind === "ack")
    )
    throw error
  }
  session.drainFor(DRAIN_MS)
  try {
    return adapter.heightMap.parse(complete, clock.now(), deviceId)
  } catch (error) {
    throw new MachineError(
      "rejected",
      error instanceof Error ? error.message : "Invalid height map response."
    )
  }
}

/** The machine's switches as it reads them now (`FirmwareAdapter.switches`): it changes nothing. */
export async function readSwitches(
  context: OperationContext
): Promise<SwitchReport> {
  const { session, adapter, clock, signal } = context
  const switches = adapter.switches
  if (!switches)
    throw new MachineError(
      "refused",
      "This machine does not report its switches."
    )
  const before = await freshStatus(
    context,
    "Timed out waiting for fresh device status. The switches were not read."
  )
  requireAdmission(context, { key: "readSwitches" }, before)
  let report: Omit<SwitchReport, "at"> | null = null
  const response = session.request<Omit<SwitchReport, "at">>(
    [switches.query],
    (event) => {
      if (event.kind !== "line") return "ignored"
      const { kind, text } = event.line
      const parsed = switches.parse(text)
      if (parsed) {
        report = parsed
        return "consumed"
      }
      if (kind === "ack" && report) return { done: report }
      if (FAILURE_LINES.has(kind))
        return {
          fail: new MachineError(
            "rejected",
            `The device rejected the switch read: ${excerpt(text)}`
          ),
        }
      return "ignored"
    },
    {
      timeoutMs: SWITCHES_MS,
      timeoutMessage: "Reading the switches timed out. It was not retried.",
      signal,
    }
  )
  const read = await response
  session.drainFor(DRAIN_MS)
  return { ...read, at: clock.now() }
}
