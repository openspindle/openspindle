import { editOperation } from "../auto-level/rules"
import { issueOf, operationSubject } from "../diagnostics"
import type { Area, Issue } from "../diagnostics"
import { toolpathBoundsOf } from "../compile/cutting-bounds"
import type {
  ToolpathBounds,
  ToolpathBoundsResult,
} from "../compile/cutting-bounds"
import { machiningPrograms, operationPhase } from "../operations/kinds"
import type { OperationRuleSubject, StageRule } from "../rules/stages"
import { autoScanParamsSchema } from "./params"
import type { AutoScanParameters, AutoScanParams } from "./params"

export type AutoScanIssueCode = "invalid-parameters" | "nothing-to-trace"

/** What blocks generating an auto-scan's NC; the compiler reports it. */
export type AutoScanIssue = Issue<AutoScanIssueCode>

const scanError = issueOf<AutoScanIssueCode>("error")

const EPSILON = 1e-6

/** Parameters and outline that generation can render, or what blocks it. */
export type AutoScanPlan =
  | { ok: true; params: AutoScanParams; outline: ToolpathBounds }
  | { ok: false; issues: AutoScanIssue[] }

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * probe (`parameters`), then something to trace.
 */
export function planAutoScan(
  params: AutoScanParams,
  toolpath: ToolpathBoundsResult,
  parameters: AutoScanParameters
): AutoScanPlan {
  const parsed = autoScanParamsSchema(parameters).safeParse(params)
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        scanError("invalid-parameters", issue.message)
      ),
    }
  if (!toolpath.ok)
    return {
      ok: false,
      issues: [
        scanError("nothing-to-trace", `Nothing to trace: ${toolpath.reason}`),
      ],
    }
  return { ok: true, params: parsed.data, outline: toolpath.bounds }
}

/**
 * Where an auto-scan's outline, the plate's cuts, leaves the stock as placed, at the stock top
 * where the scan traces it; null for another kind, without stock or cuts, or with the outline on
 * the stock.
 */
function outlineBeyondStock({
  operation,
  plate,
  kit,
}: OperationRuleSubject): Area | null {
  const { stock, stockAnchor, workOrigin } = plate.setup
  if (operation.source.kind !== "auto-scan" || !stock) return null
  const toolpath = toolpathBoundsOf(machiningPrograms(plate, kit))
  if (!toolpath.ok) return null
  const outline = toolpath.bounds
  const inside = [0, 1].every((axis) => {
    const size = axis ? stock.depth : stock.width
    const low = workOrigin[axis] + outline.min[axis]
    const high = workOrigin[axis] + outline.max[axis]
    return (
      low >= stockAnchor[axis] - EPSILON &&
      high <= stockAnchor[axis] + size + EPSILON
    )
  })
  if (inside) return null
  const top = stockAnchor[2] + stock.height
  const [x, y] = workOrigin
  return {
    kind: "area",
    min: [x + outline.min[0], y + outline.min[1], top],
    max: [x + outline.max[0], y + outline.max[1], top],
  }
}

const outlineOffStock: StageRule<"operation"> = {
  id: "auto-scan/outline-off-stock",
  stage: "operation",
  label: "Auto-scan outline on the stock",
  description:
    "Cuts that reach beyond the stock as placed are worth checking, which is what the scan is for.",
  severity: "warning",
  configurable: false,
  test: (subject) => !outlineBeyondStock(subject),
  explain: ({ first }) => {
    const outline = outlineBeyondStock(first)
    return {
      problem:
        "The cuts reach beyond the stock as placed; the scan traces where they go.",
      about: operationSubject(first.operation.id),
      ...(outline && { places: [outline] }),
    }
  },
  fixes: editOperation,
}

const afterMachining: StageRule<"operation"> = {
  id: "auto-scan/after-machining",
  stage: "operation",
  label: "Auto-scan before machining",
  description:
    "A scan after machining has started checks the outline too late.",
  severity: "warning",
  configurable: false,
  test: ({ operation, plate }) => {
    if (operation.source.kind !== "auto-scan") return true
    const index = plate.operations.findIndex((item) => item.id === operation.id)
    return plate.operations
      .slice(0, Math.max(0, index))
      .every((item) => operationPhase(item) === "setup")
  },
  explain: ({ first }) => ({
    problem:
      "Auto-scan runs after machining operations. Move it before them to check the outline first.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

/** The advice for an auto-scan operation: its outline against the stock, and its order. */
export const AUTO_SCAN_RULES: readonly StageRule<"operation">[] = [
  outlineOffStock,
  afterMachining,
]
