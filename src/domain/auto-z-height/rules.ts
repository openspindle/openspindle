import { bedAnchors } from "@/domain/anchors/stored-anchors"
import { issueOf, operationSubject } from "@/domain/diagnostics"
import type { Issue } from "@/domain/diagnostics"
import type { Point3 } from "@/domain/nc/gcode"
import type { AutoLevelIssue } from "../auto-level/issues"
import { editOperation, resolveAnchorStart } from "../auto-level/rules"
import type { MachineStart } from "../auto-level/rules"
import { autoZHeightParamsSchema } from "./params"
import type { AutoZHeightParameters, AutoZHeightParams } from "./params"
import { laterAutoLevels, placementContext } from "../probing/placement"
import type {
  LaterAutoLevel,
  PlacementContext,
  ProbePlacement,
} from "../probing/placement"
import type { OperationRuleSubject, StageRule } from "../rules/stages"

export type AutoZHeightIssueCode =
  // Parameters
  | "invalid-parameters"
  // Anchor placement against the plate's anchor snapshot
  | "anchor-snapshot-missing"
  | "anchor-unavailable"
  | "anchor-point-out-of-range"

/** What blocks generating an auto Z-height's NC; the compiler reports it. */
export type AutoZHeightIssue = Issue<AutoZHeightIssueCode>

const zHeightError = issueOf<AutoZHeightIssueCode>("error")

/** The touch happens below the probe where it is, or after travel to machine XY (G53). */
export type TouchOffStart = { kind: "probe-position" } | MachineStart

type Checked<TValue> =
  ({ ok: true } & TValue) | { ok: false; issues: AutoZHeightIssue[] }
/** Parameters and touch point that generation can render, or what blocks it. */
export type AutoZHeightPlan = Checked<{
  params: AutoZHeightParams
  start: TouchOffStart
}>

const EPSILON = 1e-6

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * probe (`parameters`), then the anchored touch point.
 */
export function planAutoZHeight(
  params: AutoZHeightParams,
  plate: PlacementContext,
  parameters: AutoZHeightParameters
): AutoZHeightPlan {
  const parsed = autoZHeightParamsSchema(parameters).safeParse(params)
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        zHeightError("invalid-parameters", issue.message)
      ),
    }
  const { placement } = parsed.data
  if (placement.kind === "probe-position")
    return { ok: true, params: parsed.data, start: { kind: "probe-position" } }
  // A point is a grid without extent; only the range message speaks of a grid.
  const resolved = resolveAnchorStart(placement, { width: 0, depth: 0 }, plate)
  if (!resolved.ok)
    return { ok: false, issues: resolved.issues.map(anchorIssue) }
  return { ok: true, params: parsed.data, start: resolved.start }
}

/**
 * Auto-level measures heights relative to its grid's first point, and the touch-off sets work Z
 * from the position without compensation. Work Z set after auto-level is therefore exact
 * anywhere; set before it, only where the grid starts: whether each later auto-level starts
 * where this placement touches.
 */
export function touchesGridStarts(
  touch: ProbePlacement,
  later: readonly LaterAutoLevel[]
): boolean {
  return later.every((grid) => probesGridStart(touch, grid))
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
    Math.abs(touch.offset.x - placement.offset.x) <= EPSILON &&
    Math.abs(touch.offset.y - placement.offset.y) <= EPSILON
  )
}

function anchorIssue(issue: AutoLevelIssue): AutoZHeightIssue {
  switch (issue.code) {
    case "anchor-snapshot-missing":
    case "anchor-unavailable":
      return { ...issue, code: issue.code }
    default:
      return zHeightError(
        "anchor-point-out-of-range",
        "The anchored probe point exceeds the supported coordinate range."
      )
  }
}

/**
 * An auto Z-height operation's touch-off as its advice reads it: where it starts, null where the
 * anchored point does not resolve (the compiler reports why). Null for another kind, a machine
 * without a probe, or parameters that do not parse (the compiler reports those too).
 */
function touchOffAdvice({
  operation,
  plate,
  kit,
}: OperationRuleSubject): { readonly start: TouchOffStart | null } | null {
  const { source } = operation
  if (source.kind !== "auto-z-height" || !kit.probe) return null
  const plan = planAutoZHeight(
    source.params,
    placementContext(plate),
    kit.probe.autoZHeight.parameters
  )
  if (plan.ok) return { start: plan.start }
  return plan.issues.some((issue) => issue.code === "invalid-parameters")
    ? null
    : { start: null }
}

/**
 * Where an anchored touch point is on the bed, and whether it is over the stock as placed; null
 * without stock, from the probe position, or where the plate does not have the anchor.
 */
function touchOnStock(subject: OperationRuleSubject): {
  readonly at: Point3
  readonly onStock: boolean
} | null {
  const start = touchOffAdvice(subject)?.start
  const { stock, stockAnchor, anchors } = subject.plate.setup
  if (!stock || start?.kind !== "machine") return null
  // Machine XY reaches the bed through the snapshot's registration, as the viewer places it.
  const anchor = bedAnchors(anchors ?? undefined).find(
    (item) => item.id === start.anchor.id
  )
  if (!anchor) return null
  const x =
    anchor.position[0] + start.target[0] - start.anchor.machinePosition[0]
  const y =
    anchor.position[1] + start.target[1] - start.anchor.machinePosition[1]
  const [stockX, stockY, stockZ] = stockAnchor
  return {
    // Beside the stock, at the height of what it stands on.
    at: [x, y, stockZ],
    onStock:
      x >= stockX - EPSILON &&
      y >= stockY - EPSILON &&
      x <= stockX + stock.width + EPSILON &&
      y <= stockY + stock.depth + EPSILON,
  }
}

/** The stock checks of a touch point: without stock, it cannot be placed on it. */
const AUTO_Z_HEIGHT_STOCK_CHAIN = "auto-z-height/stock"

const zHeightFactoryAnchors: StageRule<"operation"> = {
  id: "auto-z-height/factory-anchors",
  stage: "operation",
  label: "Auto Z-height anchors read",
  description:
    "A touch point placed from the machine's factory default anchor positions lands wherever the device's own anchors differ from them.",
  severity: "warning",
  configurable: false,
  test: (subject) => {
    const start = touchOffAdvice(subject)?.start
    return start?.kind !== "machine" || start.source !== "factory"
  },
  explain: ({ first }) => ({
    problem:
      "The anchor positions are factory defaults. Use Read anchors to verify them against the device before Run.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

const zHeightStockUnspecified: StageRule<"operation"> = {
  id: "auto-z-height/stock-unspecified",
  stage: "operation",
  label: "Auto Z-height stock size",
  description:
    "A touch point is checked against the stock, which needs its size.",
  severity: "warning",
  configurable: false,
  chain: AUTO_Z_HEIGHT_STOCK_CHAIN,
  test: (subject) =>
    !touchOffAdvice(subject) || subject.plate.setup.stock !== null,
  explain: ({ first }) => ({
    problem:
      "The stock size is unspecified, so the touch point cannot be checked against it.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

const pointOutsideStock: StageRule<"operation"> = {
  id: "auto-z-height/point-outside-stock",
  stage: "operation",
  label: "Auto Z-height point on the stock",
  description:
    "An anchored touch point off the stock sets work Z on another surface.",
  severity: "warning",
  configurable: false,
  chain: AUTO_Z_HEIGHT_STOCK_CHAIN,
  test: (subject) => touchOnStock(subject)?.onStock ?? true,
  explain: ({ first }) => {
    const touch = touchOnStock(first)
    return {
      problem:
        "The anchored probe point is off the stock as placed on the bed, so the probe would set work Z on another surface.",
      about: operationSubject(first.operation.id),
      ...(touch && { places: [{ kind: "point", at: touch.at } as const] }),
    }
  },
  fixes: editOperation,
}

const zHeightBeforeAutoLevel: StageRule<"operation"> = {
  id: "auto-z-height/before-auto-level",
  stage: "operation",
  label: "Auto Z-height after auto-level",
  description:
    "Work Z set before an auto-level is exact only where the auto-level's grid starts.",
  severity: "warning",
  configurable: false,
  test: ({ operation, plate, kit }) =>
    operation.source.kind !== "auto-z-height" ||
    !kit.probe ||
    touchesGridStarts(
      operation.source.params.placement,
      laterAutoLevels(plate, operation)
    ),
  explain: ({ first }) => ({
    problem:
      "A later auto-level measures heights from its grid's first point, so work Z is off by any height difference between that point and this one. Move Auto Z-height after Auto-level, or probe where the grid starts.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

/** The advice for an auto Z-height operation: its anchors, its point against the stock, its order. */
export const AUTO_Z_HEIGHT_RULES: readonly StageRule<"operation">[] = [
  zHeightFactoryAnchors,
  zHeightStockUnspecified,
  pointOutsideStock,
  zHeightBeforeAutoLevel,
]
