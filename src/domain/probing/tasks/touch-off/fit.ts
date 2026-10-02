import type { BedAnchor } from "@/domain/anchors/stored-anchors"
import type { XY } from "../../../geometry/frame"
import { roundMillimetres } from "../../../geometry/millimetres"
import { rectCenter } from "../../../geometry/rect"
import type { PlateMachining, WorkArea } from "../../../compile/toolpath-bounds"
import type { Plate } from "../../../plate/plate"
import type { TouchOffSpecs, TouchOffParams } from "./params"
import { defaultsOf } from "../../parameters"
import { anchorPlacementAt, placementAnchors } from "../../placement"
import type { AnchorPlacement, ProbePlacement } from "../../placement"

/** The middle of the work area on the bed. */
export function workAreaMiddle(area: WorkArea): XY<"bed"> {
  const [x, y] = rectCenter(area)
  return [roundMillimetres(x), roundMillimetres(y)]
}

/** The touch point in the middle of the work area, anchored; null when the plate has no anchors. */
export function centerTouchOff(
  area: WorkArea,
  anchors: readonly BedAnchor[],
  current: ProbePlacement,
  last: AnchorPlacement | null
): AnchorPlacement | null {
  return anchorPlacementAt(workAreaMiddle(area), anchors, current, last)
}

/**
 * A new touch-off's parameters for a plate: the method's defaults, touching the middle of the
 * area its job cuts (its stock when it machines nothing), relative to a stored anchor. Without
 * anchors or a work area it touches at the probe position.
 */
export function plateTouchOffParams(
  plate: Plate,
  parameters: TouchOffSpecs,
  machining: PlateMachining
): TouchOffParams {
  const params: TouchOffParams = {
    ...defaultsOf(parameters),
    placement: { kind: "probe-position" },
  }
  const area = machining.workArea()
  if (!area.ok) return params
  const placement = centerTouchOff(
    area.area,
    placementAnchors(plate.setup),
    params.placement,
    null
  )
  return placement ? { ...params, placement } : params
}
