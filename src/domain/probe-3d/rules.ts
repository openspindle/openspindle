import { autoLevelOrderIssues } from "../auto-z-height/rules"
import type { LaterAutoLevel } from "../auto-z-height/rules"
import { issueOf } from "../diagnostics"
import type { Issue } from "../diagnostics"
import { cornerInward, probe3dParamsSchema, setsWorkZ } from "./params"
import type { Probe3dSpecs, Probe3dParams } from "./params"
import type { Vec2 } from "../geometry/frame"
import { roundMillimetres } from "../geometry/millimetres"
import { placementHeight, resolvePlacement } from "../probing/placement"
import type { PlacementContext, PlacementFailure } from "../probing/placement"
import type { OriginPlan } from "../probing/probe"

export type Probe3dIssueCode =
  // Parameters
  | "invalid-parameters"
  // Anchor placement against the plate's anchor snapshot
  | "anchor-snapshot-missing"
  | "anchor-unavailable"
  | "anchor-point-out-of-range"
  | "factory-anchors"
  // The plate's other operations
  | "before-auto-level"

/** Errors block NC generation or Run; warnings inform without blocking. */
export type Probe3dIssue = Issue<Probe3dIssueCode>

const probeError = issueOf<Probe3dIssueCode>("error")
const probeWarning = issueOf<Probe3dIssueCode>("warning")

type Checked<TValue> =
  ({ ok: true } & TValue) | { ok: false; issues: Probe3dIssue[] }
/** Parameters and start that generation can render, or what blocks it. */
export type Probe3dPlan = Checked<OriginPlan>

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * 3D probe (`parameters`), then the anchored start.
 */
export function planProbe3d(
  params: Probe3dParams,
  plate: PlacementContext,
  parameters: Probe3dSpecs
): Probe3dPlan {
  const parsed = probe3dParamsSchema(parameters).safeParse(params)
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
export function probe3dStartOffset(
  params: Pick<Probe3dParams, "routine" | "corner" | "distance">
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

/** Issues to show while editing: generation blockers and anchor provenance. */
export function validateProbe3d(
  params: Probe3dParams,
  plate: PlacementContext,
  parameters: Probe3dSpecs
): Probe3dIssue[] {
  const plan = planProbe3d(params, plate, parameters)
  if (!plan.ok) return plan.issues
  const { start } = plan
  if (start.kind !== "anchor" || start.source !== "factory") return []
  return [
    probeWarning(
      "factory-anchors",
      "The anchor positions are factory defaults. Use Read anchors to verify them against the device before Run."
    ),
  ]
}

/**
 * A routine that sets work Z does so as auto Z-height does, from the position without height
 * compensation, while a later auto-level measures heights from its grid's first point: work Z is
 * exact after auto-level, and before it only where the grid starts. A grid from the probe
 * position does not start there even right after it, as the routine leaves the probe over what
 * it found rather than over the top it touched.
 */
export function probe3dOrderIssues(
  params: Pick<Probe3dParams, "routine" | "placement">,
  later: readonly LaterAutoLevel[]
): Probe3dIssue[] {
  if (!setsWorkZ(params.routine)) return []
  const moved = later.map((grid) => ({ ...grid, adjacent: false }))
  return autoLevelOrderIssues(params, moved).map(() =>
    probeWarning(
      "before-auto-level",
      "A later auto-level measures heights from its grid's first point, so work Z is off by any height difference between that point and the top this probing touches. Move 3D probing after Auto-level, or probe where the grid starts."
    )
  )
}

const PLACEMENT_ISSUES: Readonly<Record<PlacementFailure, Probe3dIssue>> = {
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
