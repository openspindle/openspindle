import type { BedAnchor } from "@/domain/anchors/stored-anchors"
import { anchorPlacementAt, placementAnchors } from "../auto-level/fit"
import { roundMillimetres } from "../auto-level/params"
import { plateWorkArea } from "../compile/toolpath-bounds"
import type { BedXY, WorkArea } from "../compile/toolpath-bounds"
import type { Plate } from "../plate/plate"
import { defaultAutoZHeightParams } from "./params"
import type { AutoZHeightParameters, AutoZHeightParams } from "./params"
import type { AnchorPlacement, ProbePlacement } from "../probing/placement"

/** The middle of the work area on the bed. */
export const workAreaMiddle = ({ min, max }: WorkArea): BedXY => [
  roundMillimetres((min[0] + max[0]) / 2),
  roundMillimetres((min[1] + max[1]) / 2),
]

/** The touch point in the middle of the work area, anchored; null when the plate has no anchors. */
export function centerAutoZHeight(
  area: WorkArea,
  anchors: readonly BedAnchor[],
  current: ProbePlacement,
  last: AnchorPlacement | null
): AnchorPlacement | null {
  return anchorPlacementAt(workAreaMiddle(area), anchors, current, last)
}

/**
 * A new auto Z-height for a plate: touching the middle of the area its job cuts (its stock when
 * it machines nothing), relative to a stored anchor. Without anchors or a work area it touches at
 * the probe position.
 */
export function plateAutoZHeightParams(
  plate: Plate,
  parameters: AutoZHeightParameters
): AutoZHeightParams {
  const params = defaultAutoZHeightParams(parameters)
  const area = plateWorkArea(plate)
  if (!area.ok) return params
  const placement = centerAutoZHeight(
    area.area,
    placementAnchors(plate.setup),
    params.placement,
    null
  )
  return placement ? { ...params, placement } : params
}
