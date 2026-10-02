import { gridError } from "./issues"
import type { GridIssue } from "./issues"
import { rectAt } from "../../../geometry/rect"
import { GridParamsSchema } from "./params"
import type { GridSpecs, GridParams } from "./params"
import { rangedSchema } from "../../parameters"
import { resolvePlacement } from "../../placement"
import type {
  PlacementContext,
  PlacementFailure,
  ProbeStart,
} from "../../placement"

type Checked<TValue> =
  ({ ok: true } & TValue) | { ok: false; issues: GridIssue[] }
/** Parameters and grid start that generation can render, or what blocks it. */
export type PlannedGrid = Checked<{
  params: GridParams
  start: ProbeStart
}>

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * probe (`parameters`), and the grid start.
 */
export function planGrid(
  params: GridParams,
  plate: PlacementContext,
  parameters: GridSpecs
): PlannedGrid {
  const checked = checkGridParams(params, parameters)
  if (!checked.ok) return checked
  const resolved = gridStart(checked.params, plate)
  if (!resolved.ok) return resolved
  return { ok: true, params: checked.params, start: resolved.start }
}

const PLACEMENT_ISSUES: Readonly<Record<PlacementFailure, GridIssue>> = {
  "anchor-snapshot-missing": gridError(
    "anchor-snapshot-missing",
    "Select an anchor snapshot for this plate's device."
  ),
  "anchor-unavailable": gridError(
    "anchor-unavailable",
    "The selected probe anchor is unavailable."
  ),
  "out-of-range": gridError(
    "anchor-grid-out-of-range",
    "The anchored probe grid exceeds the supported coordinate range."
  ),
}

/** The parameters within the ranges the method gives them (`parameters`), or why not. */
export function checkGridParams(
  params: GridParams,
  parameters: GridSpecs
): Checked<{ params: GridParams }> {
  const parsed = rangedSchema(GridParamsSchema, parameters).safeParse(params)
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        gridError("invalid-parameters", issue.message)
      ),
    }
  return { ok: true, params: parsed.data }
}

/** Where the grid starts on the machine, with all of it in the supported range, or why not. */
export function gridStart(
  params: GridParams,
  plate: PlacementContext
): Checked<{ start: ProbeStart }> {
  const resolved = resolvePlacement(
    params.placement,
    plate,
    rectAt([0, 0], params.size)
  )
  if (!resolved.ok)
    return { ok: false, issues: [PLACEMENT_ISSUES[resolved.error]] }
  return { ok: true, start: resolved.value }
}
