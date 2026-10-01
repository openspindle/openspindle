import type { ProbingSource } from "../operations/operation"
import type { Plate } from "../plate/plate"
import type { ItemEdgeRef } from "../plate/item-edges"
import { sameEdge } from "../plate/item-edges"
import { roundMillimetres } from "../geometry/millimetres"
import type { Point3 } from "../primitives"
import { anchorPlacementAt, placementAnchors } from "./placement"
import { originStartOffset } from "./tasks/origin/plan"
import { OUTLINE_EDGE_LIMIT, outlineTarget } from "./tasks/outline/params"

/**
 * A probing operation started at a point picked on its plate's bed: a touch-off touches there,
 * a grid starts its grid there, and 3D probing starts where its routine is best started from
 * what it finds there (`originStartOffset`: half the distances in from an outside corner, beyond
 * both walls of an inside corner). The start is anchored, from the operation's anchor or else the
 * nearest, and has no height: the probe stays at the clearance it travels at, and the routine
 * searches down for what is there, whatever work Z is. A pocket's centring, which touches no
 * top, keeps the height it has. Null for an outline, which starts nowhere, or a plate without
 * anchors.
 */
export function withPickedStart(
  source: ProbingSource,
  plate: Pick<Plate, "setup">,
  [x, y]: Point3
): ProbingSource | null {
  if (source.task === "outline") return null
  const [dx, dy] =
    source.task === "origin" ? originStartOffset(source.params) : [0, 0]
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
    params: { ...source.params, placement: started },
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
