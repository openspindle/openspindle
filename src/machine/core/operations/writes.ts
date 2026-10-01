import type {
  AddedAnchor,
  AnchorConfiguration,
  WriteAnchorsRequest,
} from "../../contract/index.ts"
import { FAILURE_LINES, excerpt } from "../../firmware/adapter.ts"
import type { AddedSlot, OutboundFrame } from "../../firmware/adapter.ts"
import { MachineError } from "../errors.ts"
import { freshStatus, requireAdmission } from "./context.ts"
import type { OperationContext } from "./context.ts"
import {
  drainAnchorReplies,
  readAddedSlots,
  readAnchorValues,
  replyText,
  withAdded,
} from "./reads.ts"
import type { AnchorSettings } from "./reads.ts"

const ANCHOR_SETTING_MS = 8000

/** The same anchor at the same place, within the micrometre a setting holds. */
const sameAdded = (left: AddedSlot, right: AddedSlot) =>
  left === right ||
  (typeof left === "object" &&
    typeof right === "object" &&
    left !== null &&
    right !== null &&
    left.id === right.id &&
    left.offset.every(
      (part, axis) => Math.abs(part - right.offset[axis]) < 0.0005
    ))

/**
 * What each place for added anchors is to hold: every anchor stays in the place that holds its
 * id, takes the first free place otherwise, else a new place after the last, and places of
 * anchors that go are freed. A place that holds what is no anchor stays as it is. Throws when the
 * anchors need more places than the machine reads.
 */
export function addedPlaces(
  slots: readonly AddedSlot[],
  anchors: readonly AddedAnchor[],
  limit: number
): AddedSlot[] {
  const places = slots.map((held): AddedSlot => {
    if (held === "other") return held
    const kept = held && anchors.find((anchor) => anchor.id === held.id)
    return kept ?? null
  })
  // A second place with the same id is freed.
  for (const [slot, anchor] of places.entries())
    if (anchor && anchor !== "other" && places.indexOf(anchor) !== slot)
      places[slot] = null
  for (const anchor of anchors) {
    if (places.includes(anchor)) continue
    const free = places.indexOf(null)
    if (free >= 0) places[free] = anchor
    else places.push(anchor)
  }
  if (places.length > limit)
    throw new MachineError(
      "invalid",
      `The device stores at most ${limit} anchors besides its own.`
    )
  return places
}

/**
 * Stores anchors in the machine's configuration, one keyed setting at a time as the machine
 * confirms each, then reads every setting back: they must hold what was written. Its own anchors
 * go to their settings; the anchors its user added go to their places (`addedPlaces`). Nothing is
 * retried. `sending` is called before the first setting leaves; from then on, what the machine
 * stores is known only from a read.
 */
export async function writeAnchorConfiguration(
  context: OperationContext,
  request: WriteAnchorsRequest,
  sending: () => void
): Promise<AnchorConfiguration> {
  const { session, adapter, clock } = context
  const { anchors } = adapter
  const write = anchors?.write
  if (!anchors || (request.anchors && !write))
    throw new MachineError(
      "refused",
      "This machine's anchors cannot be changed."
    )
  if (request.added && !anchors.added)
    throw new MachineError(
      "refused",
      "This machine stores no anchors besides its own."
    )
  let values: readonly number[] | null = null
  try {
    if (request.anchors && write) values = write.values(request.anchors)
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
  const added = request.added && anchors.added
  let places: AddedSlot[] | null = null
  let held: readonly AddedSlot[] = []
  if (request.added && added) {
    held = await readAddedSlots(context, anchors)
    places = addedPlaces(held, request.added, added.limit)
  }
  sending()
  try {
    if (values && write)
      for (const [index, key] of anchors.keys.entries()) {
        const value = values[index]
        await storeSetting(
          context,
          anchors,
          write.command(key, value),
          (text) => write.confirm(text, key, value),
          `firmware setting ${key}`
        )
      }
    if (places && added)
      for (const [slot, anchor] of places.entries()) {
        if (
          anchor === "other" ||
          (slot < held.length && sameAdded(held[slot], anchor))
        )
          continue
        await storeSetting(
          context,
          anchors,
          added.command(slot, anchor),
          (text) => added.confirm(text, slot, anchor),
          `the setting for added anchor place ${slot + 1}`
        )
      }
  } finally {
    drainAnchorReplies(session, anchors)
  }
  const stored = await readAnchorValues(context, anchors)
  if (values?.some((value, index) => stored[index] !== value))
    throw new MachineError(
      "unverified",
      "The device reads back other anchor positions than those written."
    )
  const slots = added ? await readAddedSlots(context, anchors) : undefined
  if (places?.some((anchor, slot) => !sameAdded(slots?.[slot] ?? null, anchor)))
    throw new MachineError(
      "unverified",
      "The device reads back other added anchors than those written."
    )
  try {
    return withAdded(anchors.build(stored, clock.now()), slots)
  } catch {
    throw new MachineError(
      "rejected",
      "Firmware anchor coordinates are invalid."
    )
  }
}

/** Sends one setting while the device stays idle and waits for the machine to confirm it. */
async function storeSetting(
  context: OperationContext,
  anchors: AnchorSettings,
  frame: OutboundFrame,
  confirm: (text: string) => true | string | undefined,
  name: string
) {
  const { session, signal } = context
  const current = session.store.telemetry
  if (current?.state !== "Idle" || current.job !== null)
    throw new MachineError(
      "cancelled",
      "Writing the anchors stopped because the device is no longer idle."
    )
  await session.request<true>(
    [frame],
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
      const confirmed = confirm(text)
      if (confirmed === undefined)
        return anchors.isReply(text) ? "consumed" : "ignored"
      if (confirmed !== true)
        return { fail: new MachineError("rejected", confirmed) }
      return { done: true }
    },
    {
      timeoutMs: ANCHOR_SETTING_MS,
      timeoutMessage: `Timed out storing ${name}.`,
      signal,
    }
  )
}
