import type { BedAnchor } from "@/domain/anchors/stored-anchors"
import type { PlateMachining, WorkArea } from "../../../compile/toolpath-bounds"
import type { Plate } from "../../../plate/plate"
import { roundMillimetres } from "../../../geometry/millimetres"
import { rectSize } from "../../../geometry/rect"
import type { GridSpecs, GridParams } from "./params"
import { defaultsOf } from "../../parameters"
import { anchorPlacementAt, placementAnchors } from "../../placement"
import type { AnchorPlacement, ProbePlacement } from "../../placement"

/**
 * The grid that covers the work area, within the sizes the strategy takes: its size,
 * and its start at the area's lower-left corner when the plate has anchors. Without anchors the
 * placement stays as it is.
 */
export function fitGrid(
  area: WorkArea,
  anchors: readonly BedAnchor[],
  current: ProbePlacement,
  last: AnchorPlacement | null,
  { size }: GridSpecs
): Pick<GridParams, "size" | "placement"> {
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
 * A new height grid's parameters for a plate: the grid over the area its job cuts (its stock when
 * it machines nothing), starting at a stored anchor when the plate has them. Without a work area
 * it takes the strategy's defaults at the probe position.
 */
export function plateGridParams(
  plate: Plate,
  parameters: GridSpecs,
  machining: PlateMachining
): GridParams {
  const params: GridParams = {
    ...defaultsOf(parameters),
    placement: { kind: "probe-position" },
    reviewAfterProbe: true,
  }
  const area = machining.workArea()
  if (!area.ok) return params
  return {
    ...params,
    ...fitGrid(
      area.area,
      placementAnchors(plate.setup),
      params.placement,
      null,
      parameters
    ),
  }
}
