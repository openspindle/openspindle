import { issueOf } from "../../../diagnostics"
import type { Issue } from "../../../diagnostics"
import { cornerInward, originParamsSchema } from "./params"
import type { OriginSpecs, OriginParams } from "./params"
import type { Vec2 } from "../../../geometry/frame"
import { roundMillimetres } from "../../../geometry/millimetres"
import { placementHeight, resolvePlacement } from "../../placement"
import type { PlacementContext, PlacementFailure } from "../../placement"
import type { OriginPlan } from "../../probe"

export type OriginIssueCode =
  // Parameters
  | "invalid-parameters"
  // Anchor placement against the plate's anchor snapshot
  | "anchor-snapshot-missing"
  | "anchor-unavailable"
  | "anchor-point-out-of-range"

/** What blocks generating a 3D probing's NC; the compiler reports it. */
export type OriginIssue = Issue<OriginIssueCode>

const probeError = issueOf<OriginIssueCode>("error")

type Checked<TValue> =
  ({ ok: true } & TValue) | { ok: false; issues: OriginIssue[] }
/** Parameters and start that generation can render, or what blocks it. */
export type PlannedOrigin = Checked<OriginPlan>

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * 3D probe (`parameters`), then the anchored start.
 */
export function planOrigin(
  params: OriginParams,
  plate: PlacementContext,
  parameters: OriginSpecs
): PlannedOrigin {
  const parsed = originParamsSchema(parameters).safeParse(params)
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        probeError("invalid-parameters", issue.message)
      ),
    }
  const { placement } = parsed.data
  const onBed = placementHeight(placement)
  const height =
    onBed === undefined ? null : roundMillimetres(onBed - plate.workOriginZ)
  const resolved = resolvePlacement(placement, plate)
  if (!resolved.ok)
    return { ok: false, issues: [PLACEMENT_ISSUES[resolved.error]] }
  return { ok: true, params: parsed.data, start: resolved.value, height }
}

/**
 * Where the probe is best started from what the routine finds, which positioning it says: half
 * the distance in from an outside corner, over its top, as far out over the top from an inside
 * corner, and over the middle of a pocket or boss.
 */
export function originStartOffset(
  params: Pick<OriginParams, "routine" | "corner" | "distance">
): Vec2 {
  const [inX, inY] = cornerInward(params.corner)
  const [halfX, halfY] = params.distance.map((value) =>
    Number((value / 2).toFixed(6))
  )
  switch (params.routine) {
    case "outside-corner":
      return [inX * halfX, inY * halfY]
    case "inside-corner":
      return [-inX * halfX, -inY * halfY]
    default:
      return [0, 0]
  }
}

const PLACEMENT_ISSUES: Readonly<Record<PlacementFailure, OriginIssue>> = {
  "anchor-snapshot-missing": probeError(
    "anchor-snapshot-missing",
    "Select an anchor snapshot for this plate's device."
  ),
  "anchor-unavailable": probeError(
    "anchor-unavailable",
    "The selected probe anchor is unavailable."
  ),
  "out-of-range": probeError(
    "anchor-point-out-of-range",
    "The anchored start exceeds the supported coordinate range."
  ),
}
