import type { ProbingSource } from "../operations/operation"
import type { Plate } from "../plate/plate"
import type { ItemEdgeRef } from "../plate/item-edges"
import { sameEdge } from "../plate/item-edges"
import type { PickTarget } from "../plate/pick-targets"
import { roundMillimetres } from "../geometry/millimetres"
import type { Point3 } from "../primitives"
import { anchorPlacementAt, placementAnchors } from "./placement"
import type { OriginParams } from "./tasks/origin/params"
import { originStartOffset } from "./tasks/origin/plan"
import { OUTLINE_EDGE_LIMIT, outlineTarget } from "./tasks/outline/params"

/**
 * A corner routine finding the corner a picked target is, as its routine names corners: an
 * outside corner's target for an outside corner, an inside corner's for an inside corner. Other
 * targets, and other routines, leave the corner as it is.
 */
function withTargetCorner(
  params: OriginParams,
  target: PickTarget | null | undefined
): OriginParams {
  if (!target?.corner || target.kind !== params.routine) return params
  return { ...params, corner: target.corner }
}

/**
 * A probing operation started at a point picked on its plate's bed (its X and Y; Z is not read):
 * a touch-off touches there, a grid starts its grid there, and 3D probing starts where its
 * routine is best started from what it finds there (`originStartOffset`: half the distances in
 * from an outside corner, beyond both walls of an inside corner). A corner routine picked on a
 * corner target of its kind (`pickTargets`) finds that corner, from there. The start is
 * anchored, from the operation's anchor or else the first (Anchor 1 on the Z1), and has no
 * height: the probe stays at the clearance it travels at, and the routine searches down for what
 * is there, whatever work Z is. A pocket's centring, which touches no top, keeps the height it
 * has. Null for an outline, which starts nowhere, or a plate without anchors.
 */
export function withPickedStart(
  source: ProbingSource,
  plate: Pick<Plate, "setup">,
  [x, y]: Point3,
  target?: PickTarget | null
): ProbingSource | null {
  if (source.task === "outline") return null
  const origin =
    source.task === "origin" ? withTargetCorner(source.params, target) : null
  const params = origin ?? source.params
  const [dx, dy] = origin ? originStartOffset(origin) : [0, 0]
  const current = source.params.placement
  const placement = anchorPlacementAt(
    [roundMillimetres(x + dx), roundMillimetres(y + dy)],
    placementAnchors(plate.setup),
    current,
    null
  )
  if (!placement) return null
  const keepsHeight =
    source.task === "origin" &&
    source.params.routine === "pocket-center" &&
    current.height !== undefined
  const started = keepsHeight
    ? { ...placement, height: current.height }
    : placement
  return {
    ...source,
    params: { ...params, placement: started },
  } as ProbingSource
}

/**
 * An outline tracing a picked edge too, or no longer when it traced it; null for another
 * operation, or one that traces as many edges as it can.
 */
export function withPickedEdge(
  source: ProbingSource,
  edge: ItemEdgeRef
): ProbingSource | null {
  if (source.task !== "outline") return null
  const target = outlineTarget(source.params)
  const edges = target.kind === "edges" ? target.edges : []
  const traced = edges.some((item) => sameEdge(item, edge))
  if (!traced && edges.length >= OUTLINE_EDGE_LIMIT) return null
  return {
    ...source,
    params: {
      ...source.params,
      target: {
        kind: "edges",
        edges: traced
          ? edges.filter((item) => !sameEdge(item, edge))
          : [...edges, edge],
      },
    },
  }
}
