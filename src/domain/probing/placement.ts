/**
 * Where a probing operation starts: over the probe's position, or over a stored anchor of the
 * plate's device plus an offset, as setup items keep their points relative to an anchor. Its
 * height, when an operation takes one, is a height on the bed, like theirs.
 */

import { z } from "zod"
import {
  bedAnchors,
  isAnchorXY,
  isStoredAnchorSetup,
} from "../anchors/stored-anchors"
import type {
  BedAnchor,
  StoredAnchor,
  StoredAnchorSetup,
} from "../anchors/stored-anchors"
import { plus } from "../geometry/frame"
import type { XY } from "../geometry/frame"
import { EPSILON, roundMillimetres } from "../geometry/millimetres"
import type { Rect } from "../geometry/rect"
import type { Operation } from "../operations/operation"
import type { Plate } from "../plate/plate"
import { workOriginOnMachine } from "../plate/work-origin"
import { COORDINATE_LIMIT, fail, ok } from "../primitives"
import type { Result } from "../primitives"

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
  height: heightSchema,
})

/**
 * G53 travel to a stored anchor of the plate's device, plus an offset in X and Y, at the height
 * the probe travels at on the machine.
 */
export const AnchorPlacementSchema = z.strictObject({
  kind: z.literal("anchor"),
  anchorId: AnchorIdSchema,
  /** X and Y relative to the anchor's machine XY, mm. */
  offset: z.tuple([coordinateSchema("X"), coordinateSchema("Y")]),
  height: heightSchema,
})

export const ProbePlacementSchema = z.discriminatedUnion("kind", [
  ProbePositionPlacementSchema,
  AnchorPlacementSchema,
])

export type ProbePlacement = z.infer<typeof ProbePlacementSchema>
export type AnchorPlacement = z.infer<typeof AnchorPlacementSchema>

/** The height on the bed a placement starts at; undefined where the probe stays at its travel height. */
export const placementHeight = (placement: ProbePlacement) => placement.height

/** The plate's device and its anchor snapshot. `Plate` satisfies it. */
export type PlacementContext = {
  deviceId: string | null
  anchorSetup?: StoredAnchorSetup
  /**
   * The machine XY the program makes work X0 Y0 before its operations, from the same anchor
   * snapshot; null when it leaves the machine's work X and Y as they are.
   */
  machineWorkOrigin?: XY<"machine"> | null
  /** The plate's work origin's height on the bed, which work Z0 is on. */
  workOriginZ: number
}

/** Where a plate's probing operations start: its device, anchor snapshot and work origin. */
export const placementContext = ({
  setup,
}: Pick<Plate, "setup">): PlacementContext => ({
  deviceId: setup.deviceId,
  anchorSetup: setup.anchors ?? undefined,
  machineWorkOrigin: workOriginOnMachine(setup)?.position ?? null,
  workOriginZ: setup.workOrigin[2],
})

/**
 * Where an operation starts on the machine: where the operator put the probe, or over a stored
 * anchor plus the placement's offset, which the program travels to first.
 */
export type ProbeStart = { readonly kind: "probe-position" } | AnchorStart

/** A start at a stored anchor plus an offset: travel to machine XY (G53), then the operation. */
export type AnchorStart = {
  readonly kind: "anchor"
  readonly anchor: StoredAnchor
  readonly source: StoredAnchorSetup["source"]
  /** Where the program travels to, in machine coordinates. */
  readonly machine: XY<"machine">
  /** The same point in work coordinates when the program sets work X and Y; null otherwise. */
  readonly work: XY<"work"> | null
}

/** Why a placement has no start on the machine. */
export type PlacementFailure =
  "anchor-snapshot-missing" | "anchor-unavailable" | "out-of-range"

/** An operation that probes where it starts, and nowhere else. */
const AT_START: Rect<"probe"> = { min: [0, 0], max: [0, 0] }

/**
 * Where a placement starts on the machine, for an operation that probes within `footprint`
 * around its start: the plate's anchor snapshot must be of its device and hold the anchor, and
 * all of the footprint must lie within the supported coordinate range. Failures keep the order of
 * these checks.
 */
export function resolvePlacement(
  placement: ProbePlacement,
  context: PlacementContext,
  footprint: Rect<"probe"> = AT_START
): Result<ProbeStart, PlacementFailure> {
  if (placement.kind === "probe-position") return ok({ kind: "probe-position" })
  const setup = context.anchorSetup
  if (!isStoredAnchorSetup(setup) || setup.deviceId !== context.deviceId)
    return fail("anchor-snapshot-missing")
  const anchor = setup.anchors.find((item) => item.id === placement.anchorId)
  if (!anchor) return fail("anchor-unavailable")
  const machine = plus<"machine">(anchor.machinePosition, placement.offset)
  if (
    !isAnchorXY(plus(machine, footprint.min)) ||
    !isAnchorXY(plus(machine, footprint.max))
  )
    return fail("out-of-range")
  const origin = context.machineWorkOrigin ?? null
  const work: XY<"work"> | null = origin
    ? [
        roundMillimetres(machine[0] - origin[0]),
        roundMillimetres(machine[1] - origin[1]),
      ]
    : null
  return ok({ kind: "anchor", anchor, source: setup.source, machine, work })
}

/** The anchors a placement can be relative to: the snapshot of the plate's device, on the bed. */
export function placementAnchors(setup: {
  deviceId: string | null
  anchors: StoredAnchorSetup | null
}): BedAnchor[] {
  const { anchors, deviceId } = setup
  return isStoredAnchorSetup(anchors) && anchors.deviceId === deviceId
    ? bedAnchors(anchors)
    : []
}

/**
 * The anchored placement of a bed point: relative to the current (or last) anchor while the plate
 * has it, otherwise to the first, the bed's origin (Anchor 1 on the Z1). The offset is the point's
 * distance from the anchor on the bed, which the G53 travel repeats in machine coordinates. Null
 * when the plate has no anchors.
 */
export function anchorPlacementAt(
  point: XY<"bed">,
  anchors: readonly BedAnchor[],
  current: ProbePlacement,
  last: AnchorPlacement | null
): AnchorPlacement | null {
  const previous = current.kind === "anchor" ? current : last
  const anchor =
    anchors.find((item) => item.id === previous?.anchorId) ?? anchors.at(0)
  if (!anchor) return null
  return {
    kind: "anchor",
    anchorId: anchor.id,
    offset: [
      roundMillimetres(point[0] - anchor.position[0]),
      roundMillimetres(point[1] - anchor.position[1]),
    ],
  }
}

/** A grid that runs after an operation, and whether it follows it directly. */
export type LaterGrid = {
  readonly placement: ProbePlacement
  /** Next in the plate without a Pause before, so the probe has not moved in between. */
  readonly adjacent: boolean
}

/** The grids after an operation, which measure their heights from their own start. */
export function laterGrids(plate: Plate, operation: Operation): LaterGrid[] {
  const index = plate.operations.findIndex((item) => item.id === operation.id)
  if (index < 0) return []
  return plate.operations.slice(index + 1).flatMap((later, offset) =>
    later.source.kind === "probing" && later.source.task === "grid"
      ? [
          {
            placement: later.source.params.placement,
            adjacent: offset === 0 && !later.stopBefore,
          },
        ]
      : []
  )
}

/**
 * A grid measures heights relative to its first point, and a touch-off sets work Z from the
 * position without compensation. Work Z set after the grid is therefore exact anywhere; set
 * before it, only where the grid starts: whether each later grid starts where this placement
 * touches.
 */
export function touchesGridStarts(
  touch: ProbePlacement,
  later: readonly LaterGrid[]
): boolean {
  return later.every((grid) => probesGridStart(touch, grid))
}

function probesGridStart(
  touch: ProbePlacement,
  { placement, adjacent }: LaterGrid
): boolean {
  // A grid from the probe's position starts where the probe is: above the point just touched.
  if (placement.kind === "probe-position") return adjacent
  return (
    touch.kind === "anchor" &&
    touch.anchorId === placement.anchorId &&
    Math.abs(touch.offset[0] - placement.offset[0]) <= EPSILON &&
    Math.abs(touch.offset[1] - placement.offset[1]) <= EPSILON
  )
}
