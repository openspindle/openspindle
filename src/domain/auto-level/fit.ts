import {
  bedAnchors,
  isStoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import type {
  BedAnchor,
  StoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import { plateWorkArea } from "../compile/toolpath-bounds"
import type { BedXY, WorkArea } from "../compile/toolpath-bounds"
import type { Plate } from "../plate/plate"
import { defaultAutoLevelParams, roundMillimetres } from "./params"
import type { AutoLevelGridParameters, AutoLevelParams } from "./params"
import type { AnchorPlacement, ProbePlacement } from "../probing/placement"

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

function nearest(anchors: readonly BedAnchor[], [x, y]: BedXY) {
  let best: BedAnchor | null = null
  let bestDistance = Infinity
  for (const anchor of anchors) {
    const distance =
      (anchor.position[0] - x) ** 2 + (anchor.position[1] - y) ** 2
    if (distance < bestDistance) {
      best = anchor
      bestDistance = distance
    }
  }
  return best
}

/**
 * The anchored placement of a bed point: relative to the current (or last) anchor while the plate
 * has it, otherwise to the anchor nearest the point. The offset is the point's distance from the
 * anchor on the bed, which the G53 travel repeats in machine coordinates. Null when the plate has
 * no anchors.
 */
export function anchorPlacementAt(
  point: BedXY,
  anchors: readonly BedAnchor[],
  current: ProbePlacement,
  last: AnchorPlacement | null
): AnchorPlacement | null {
  const previous = current.kind === "anchor" ? current : last
  const anchor =
    anchors.find((item) => item.id === previous?.anchorId) ??
    nearest(anchors, point)
  if (!anchor) return null
  return {
    kind: "anchor",
    anchorId: anchor.id,
    offset: {
      x: roundMillimetres(point[0] - anchor.position[0]),
      y: roundMillimetres(point[1] - anchor.position[1]),
    },
  }
}

/**
 * The grid that covers the work area, within the sizes the machine's probe accepts: its size,
 * and its start at the area's lower-left corner when the plate has anchors. Without anchors the
 * placement stays as it is.
 */
export function fitAutoLevelGrid(
  area: WorkArea,
  anchors: readonly BedAnchor[],
  current: ProbePlacement,
  last: AnchorPlacement | null,
  { width, depth }: AutoLevelGridParameters
): Pick<AutoLevelParams, "width" | "depth" | "placement"> {
  const extent = (axis: 0 | 1, bounds: { min: number; max: number }) =>
    Math.min(
      bounds.max,
      Math.max(bounds.min, roundMillimetres(area.max[axis] - area.min[axis]))
    )
  return {
    width: extent(0, width),
    depth: extent(1, depth),
    placement: anchorPlacementAt(area.min, anchors, current, last) ?? current,
  }
}

/**
 * A new auto-level for a plate: the grid over the area its job cuts (its stock when it machines
 * nothing), starting at a stored anchor when the plate has them. Without a work area it takes the
 * probe's defaults at the probe position.
 */
export function plateAutoLevelParams(
  plate: Plate,
  parameters: AutoLevelGridParameters
): AutoLevelParams {
  const params = defaultAutoLevelParams(parameters)
  const area = plateWorkArea(plate)
  if (!area.ok) return params
  return {
    ...params,
    ...fitAutoLevelGrid(
      area.area,
      placementAnchors(plate.setup),
      params.placement,
      null,
      parameters
    ),
  }
}
