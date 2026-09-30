import type { BedAnchor } from "@/domain/anchors/stored-anchors"
import { plateWorkArea } from "../compile/toolpath-bounds"
import type { WorkArea } from "../compile/toolpath-bounds"
import type { Plate } from "../plate/plate"
import { roundMillimetres } from "../geometry/millimetres"
import { rectSize } from "../geometry/rect"
import type { AutoLevelSpecs, AutoLevelParams } from "./params"
import { defaultsOf } from "../probing/parameters"
import { anchorPlacementAt, placementAnchors } from "../probing/placement"
import type { AnchorPlacement, ProbePlacement } from "../probing/placement"

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
  { size }: AutoLevelSpecs
): Pick<AutoLevelParams, "size" | "placement"> {
  const extent = rectSize(area)
  const fit = (axis: 0 | 1) =>
    Math.min(
      size[axis].max,
      Math.max(size[axis].min, roundMillimetres(extent[axis]))
    )
  return {
    size: [fit(0), fit(1)],
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
  parameters: AutoLevelSpecs
): AutoLevelParams {
  const params: AutoLevelParams = {
    ...defaultsOf(parameters),
    placement: { kind: "probe-position" },
    reviewAfterProbe: true,
  }
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
