import { machineToBed } from "@/domain/anchors/stored-anchors"
import { issueOf } from "@/domain/diagnostics"
import type { Issue } from "@/domain/diagnostics"
import type { Stock } from "@/domain/stock/stock"
import type { XYZ } from "../geometry/frame"
import { EPSILON } from "../geometry/millimetres"
import { contains, rectAt } from "../geometry/rect"
import { AutoZHeightParamsSchema } from "./params"
import type { AutoZHeightParameters, AutoZHeightParams } from "./params"
import { rangedSchema } from "../probing/parameters"
import { resolvePlacement } from "../probing/placement"
import type {
  PlacementContext,
  PlacementFailure,
  ProbePlacement,
  ProbeStart,
} from "../probing/placement"
import type { ProbingPlan } from "../probing/probe"

export type AutoZHeightIssueCode =
  // Parameters
  | "invalid-parameters"
  // Anchor placement against the plate's anchor snapshot
  | "anchor-snapshot-missing"
  | "anchor-unavailable"
  | "anchor-point-out-of-range"
  | "factory-anchors"
  // Stock and the plate's other operations
  | "stock-unspecified"
  | "point-outside-stock"
  | "before-auto-level"

/** Errors block NC generation or Run; warnings inform without blocking. */
export type AutoZHeightIssue = Issue<AutoZHeightIssueCode>

const zHeightError = issueOf<AutoZHeightIssueCode>("error")
const zHeightWarning = issueOf<AutoZHeightIssueCode>("warning")

/** The plate an auto Z-height operation belongs to. */
export type AutoZHeightPlateContext = PlacementContext & {
  stock: Pick<Stock, "width" | "depth" | "height"> | null
  /** Bed position of the stock's minimum corner. */
  stockAnchor: XYZ<"bed">
}

type Checked<TValue> =
  ({ ok: true } & TValue) | { ok: false; issues: AutoZHeightIssue[] }
/** Parameters and touch point that generation can render, or what blocks it. */
export type AutoZHeightPlan = Checked<ProbingPlan<AutoZHeightParams>>

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * probe (`parameters`), then the anchored touch point.
 */
export function planAutoZHeight(
  params: AutoZHeightParams,
  plate: PlacementContext,
  parameters: AutoZHeightParameters
): AutoZHeightPlan {
  const parsed = rangedSchema(AutoZHeightParamsSchema, parameters).safeParse(
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

/** Issues to show while editing: generation blockers, anchor provenance and the stock. */
export function validateAutoZHeight(
  params: AutoZHeightParams,
  plate: AutoZHeightPlateContext,
  parameters: AutoZHeightParameters
): AutoZHeightIssue[] {
  const plan = planAutoZHeight(params, plate, parameters)
  if (
    !plan.ok &&
    plan.issues.some((issue) => issue.code === "invalid-parameters")
  )
    return plan.issues
  const start = plan.ok ? plan.start : null
  return [
    ...(plan.ok ? [] : plan.issues),
    ...(start?.kind === "anchor" && start.source === "factory"
      ? [
          zHeightWarning(
            "factory-anchors",
            "The anchor positions are factory defaults. Use Read anchors to verify them against the device before Run."
          ),
        ]
      : []),
    ...stockIssues(plate, start),
  ]
}

/** An auto-level that runs after this operation, and whether it follows it directly. */
export type LaterAutoLevel = {
  placement: ProbePlacement
  /** Next in the plate without a Pause before, so the probe has not moved in between. */
  adjacent: boolean
}

/**
 * Auto-level measures heights relative to its grid's first point, and the touch-off sets work Z
 * from the position without compensation. Work Z set after auto-level is therefore exact
 * anywhere; set before it, only where the grid starts.
 */
export function autoLevelOrderIssues(
  params: Pick<AutoZHeightParams, "placement">,
  later: readonly LaterAutoLevel[]
): AutoZHeightIssue[] {
  if (later.every((grid) => probesGridStart(params.placement, grid))) return []
  return [
    zHeightWarning(
      "before-auto-level",
      "A later auto-level measures heights from its grid's first point, so work Z is off by any height difference between that point and this one. Move Auto Z-height after Auto-level, or probe where the grid starts."
    ),
  ]
}

function probesGridStart(
  touch: ProbePlacement,
  { placement, adjacent }: LaterAutoLevel
): boolean {
  // A grid from the probe's position starts where the probe is: above the point just touched.
  if (placement.kind === "probe-position") return adjacent
  return (
    touch.kind === "anchor" &&
    touch.anchorId === placement.anchorId &&
    Math.abs(touch.offset[0] - placement.offset[0]) <= EPSILON &&
    Math.abs(touch.offset[1] - placement.offset[1]) <= EPSILON
  )
}

const PLACEMENT_ISSUES: Readonly<Record<PlacementFailure, AutoZHeightIssue>> = {
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

function stockIssues(
  plate: AutoZHeightPlateContext,
  start: ProbeStart | null
): AutoZHeightIssue[] {
  const { stock } = plate
  if (!stock)
    return [
      zHeightWarning(
        "stock-unspecified",
        "The stock size is unspecified, so the touch point cannot be checked against it."
      ),
    ]
  if (start?.kind !== "anchor" || !plate.anchorSetup) return []
  // Machine XY reaches the bed through the snapshot's registration, as the viewer places it.
  const [x, y] = machineToBed(plate.anchorSetup)(start.machine)
  const [stockX, stockY, stockZ] = plate.stockAnchor
  const stockFootprint = rectAt<"bed">(
    [stockX, stockY],
    [stock.width, stock.depth]
  )
  if (contains(stockFootprint, [x, y])) return []
  return [
    zHeightWarning(
      "point-outside-stock",
      "The anchored probe point is off the stock as placed on the bed, so the probe would set work Z on another surface.",
      // Beside the stock, at the height of what it stands on.
      { places: [{ kind: "point", at: [x, y, stockZ] }] }
    ),
  ]
}
