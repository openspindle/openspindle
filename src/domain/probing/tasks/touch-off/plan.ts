import { issueOf } from "@/domain/diagnostics"
import type { Issue } from "@/domain/diagnostics"
import { TouchOffParamsSchema } from "./params"
import type { TouchOffSpecs, TouchOffParams } from "./params"
import { rangedSchema } from "../../parameters"
import { resolvePlacement } from "../../placement"
import type { PlacementContext, PlacementFailure } from "../../placement"
import type { ProbingPlan } from "../../probe"

export type TouchOffIssueCode =
  // Parameters
  | "invalid-parameters"
  // Anchor placement against the plate's anchor snapshot
  | "anchor-snapshot-missing"
  | "anchor-unavailable"
  | "anchor-point-out-of-range"

/** What blocks generating a touch-off's NC; the compiler reports it. */
export type TouchOffIssue = Issue<TouchOffIssueCode>

const zHeightError = issueOf<TouchOffIssueCode>("error")

type Checked<TValue> =
  ({ ok: true } & TValue) | { ok: false; issues: TouchOffIssue[] }
/** Parameters and touch point that generation can render, or what blocks it. */
export type PlannedTouchOff = Checked<ProbingPlan<TouchOffParams>>

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * probe (`parameters`), then the anchored touch point.
 */
export function planTouchOff(
  params: TouchOffParams,
  plate: PlacementContext,
  parameters: TouchOffSpecs
): PlannedTouchOff {
  const parsed = rangedSchema(TouchOffParamsSchema, parameters).safeParse(
    params
  )
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        zHeightError("invalid-parameters", issue.message)
      ),
    }
  const resolved = resolvePlacement(parsed.data.placement, plate)
  if (!resolved.ok)
    return { ok: false, issues: [PLACEMENT_ISSUES[resolved.error]] }
  return { ok: true, params: parsed.data, start: resolved.value }
}

const PLACEMENT_ISSUES: Readonly<Record<PlacementFailure, TouchOffIssue>> = {
  "anchor-snapshot-missing": zHeightError(
    "anchor-snapshot-missing",
    "Select an anchor snapshot for this plate's device."
  ),
  "anchor-unavailable": zHeightError(
    "anchor-unavailable",
    "The selected probe anchor is unavailable."
  ),
  "out-of-range": zHeightError(
    "anchor-point-out-of-range",
    "The anchored probe point exceeds the supported coordinate range."
  ),
}
