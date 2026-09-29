/**
 * Where a probing operation starts: over the probe's position, or over a stored anchor of the
 * plate's device plus an offset, as setup items keep their points relative to an anchor. Its Z,
 * when an operation takes one, is a height on the bed, like theirs.
 */

import { z } from "zod"
import type { StoredAnchorSetup } from "../anchors/stored-anchors"
import { COORDINATE_LIMIT } from "../primitives"

function coordinateSchema(label: string) {
  const range = `${label} must be from ${-COORDINATE_LIMIT} to ${COORDINATE_LIMIT} mm.`
  return z
    .number({ error: `${label} is required.` })
    .min(-COORDINATE_LIMIT, range)
    .max(COORDINATE_LIMIT, range)
}

/** The height on the bed the probe comes down to before it starts, mm; absent, it stays up. */
const heightSchema = coordinateSchema("Z").optional()

/** Stored anchor IDs: 1–200 characters without control characters. */
const AnchorIdSchema = z
  .string({ error: "Select an anchor." })
  .min(1, "Select an anchor.")
  .max(200, "Anchor IDs have at most 200 characters.")
  .refine(
    (id) => ![...id].some((character) => character.charCodeAt(0) < 32),
    "Anchor IDs cannot contain control characters."
  )

/** Where the operator positions the probe before Run; X and Y are the probe's. */
export const ProbePositionPlacementSchema = z.strictObject({
  kind: z.literal("probe-position"),
  offset: z.strictObject({ z: heightSchema }).optional(),
})

/**
 * G53 travel to a stored anchor of the plate's device, plus an offset in X and Y, at the height
 * the machine's probe travels at.
 */
export const AnchorPlacementSchema = z.strictObject({
  kind: z.literal("anchor"),
  anchorId: AnchorIdSchema,
  /** X and Y relative to the anchor's machine XY, mm. */
  offset: z.strictObject({
    x: coordinateSchema("X"),
    y: coordinateSchema("Y"),
    z: heightSchema,
  }),
})

export const ProbePlacementSchema = z.discriminatedUnion("kind", [
  ProbePositionPlacementSchema,
  AnchorPlacementSchema,
])

export type ProbePlacement = z.infer<typeof ProbePlacementSchema>
export type AnchorPlacement = z.infer<typeof AnchorPlacementSchema>

/** The height on the bed a placement starts at; undefined where the probe stays at its travel height. */
export const placementHeight = (placement: ProbePlacement) =>
  placement.offset?.z

/** The plate's device and its anchor snapshot. `Plate` satisfies it. */
export type PlacementContext = {
  deviceId: string | null
  anchorSetup?: StoredAnchorSetup
  /**
   * The machine XY the program makes work X0 Y0 before its operations, from the same anchor
   * snapshot; null when it leaves the machine's work X and Y as they are.
   */
  machineWorkOrigin?: readonly [number, number] | null
  /** The plate's work origin's height on the bed, which work Z0 is on. */
  workOriginZ: number
}
