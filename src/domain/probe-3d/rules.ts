import type { AutoLevelIssue } from "../auto-level/issues"
import { resolveAnchorStart } from "../auto-level/rules"
import { autoLevelOrderIssues } from "../auto-z-height/rules"
import type { LaterAutoLevel, TouchOffStart } from "../auto-z-height/rules"
import type { BedXY } from "../compile/toolpath-bounds"
import { issueOf } from "../diagnostics"
import type { Issue } from "../diagnostics"
import { cornerInward, probe3dParamsSchema, setsWorkZ } from "./params"
import type { Probe3dParameters, Probe3dParams } from "./params"
import { roundMillimetres } from "../auto-level/params"
import { placementHeight } from "../probing/placement"
import type { PlacementContext } from "../probing/placement"

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
export type Probe3dPlan = Checked<{
  params: Probe3dParams
  start: TouchOffStart
  /** The work Z the probe comes down to over the start: its height on the bed, if any. */
  height: number | null
}>

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * 3D probe (`parameters`), then the anchored start.
 */
export function planProbe3d(
  params: Probe3dParams,
  plate: PlacementContext,
  parameters: Probe3dParameters
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
  if (placement.kind === "probe-position")
    return {
      ok: true,
      params: parsed.data,
      start: { kind: "probe-position" },
      height,
    }
  // A start is a grid without extent; only the range message speaks of a grid.
  const resolved = resolveAnchorStart(placement, { width: 0, depth: 0 }, plate)
  if (!resolved.ok)
    return { ok: false, issues: resolved.issues.map(anchorIssue) }
  return { ok: true, params: parsed.data, start: resolved.start, height }
}

/**
 * Where the probe is best started from what the routine finds, which positioning it says: half
 * the distance in from an outside corner, over its top, as far out over the top from an inside
 * corner, and over the middle of a pocket or boss.
 */
export function probe3dStartOffset(
  params: Pick<Probe3dParams, "routine" | "corner" | "distanceX" | "distanceY">
): BedXY {
  const [inX, inY] = cornerInward(params.corner)
  const half = (value: number) => Number((value / 2).toFixed(6))
  switch (params.routine) {
    case "outside-corner":
      return [inX * half(params.distanceX), inY * half(params.distanceY)]
    case "inside-corner":
      return [-inX * half(params.distanceX), -inY * half(params.distanceY)]
    default:
      return [0, 0]
  }
}

/** Issues to show while editing: generation blockers and anchor provenance. */
export function validateProbe3d(
  params: Probe3dParams,
  plate: PlacementContext,
  parameters: Probe3dParameters
): Probe3dIssue[] {
  const plan = planProbe3d(params, plate, parameters)
  if (!plan.ok) return plan.issues
  const { start } = plan
  if (start.kind !== "machine" || start.source !== "factory") return []
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

function anchorIssue(issue: AutoLevelIssue): Probe3dIssue {
  switch (issue.code) {
    case "anchor-snapshot-missing":
    case "anchor-unavailable":
      return { ...issue, code: issue.code }
    default:
      return probeError(
        "anchor-point-out-of-range",
        "The anchored start exceeds the supported coordinate range."
      )
  }
}
