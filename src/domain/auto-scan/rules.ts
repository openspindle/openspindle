import { issueOf } from "../diagnostics"
import type { Issue } from "../diagnostics"
import type {
  ToolpathBounds,
  ToolpathBoundsResult,
} from "../compile/cutting-bounds"
import type { PlateSetup } from "../plate/plate"
import { autoScanParamsSchema } from "./params"
import type { AutoScanParameters, AutoScanParams } from "./params"

export type AutoScanIssueCode =
  | "invalid-parameters"
  | "nothing-to-trace"
  | "outline-off-stock"
  | "after-machining"

/** Errors block NC generation or Run; warnings inform without blocking. */
export type AutoScanIssue = Issue<AutoScanIssueCode>

const scanError = issueOf<AutoScanIssueCode>("error")
const scanWarning = issueOf<AutoScanIssueCode>("warning")

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

/** Where the outline leaves the stock as placed, which is what the scan is for. */
export function outlineStockIssues(
  outline: ToolpathBounds,
  setup: Pick<PlateSetup, "stock" | "stockAnchor" | "workOrigin">
): AutoScanIssue[] {
  const { stock, stockAnchor, workOrigin } = setup
  if (!stock) return []
  const inside = [0, 1].every((axis) => {
    const size = axis ? stock.depth : stock.width
    const low = workOrigin[axis] + outline.min[axis]
    const high = workOrigin[axis] + outline.max[axis]
    return (
      low >= stockAnchor[axis] - EPSILON &&
      high <= stockAnchor[axis] + size + EPSILON
    )
  })
  if (inside) return []
  // The outline the scan traces, at the stock top.
  const top = stockAnchor[2] + stock.height
  const [x, y] = workOrigin
  return [
    scanWarning(
      "outline-off-stock",
      "The cuts reach beyond the stock as placed; the scan traces where they go.",
      {
        places: [
          {
            kind: "area",
            min: [x + outline.min[0], y + outline.min[1], top],
            max: [x + outline.max[0], y + outline.max[1], top],
          },
        ],
      }
    ),
  ]
}

/** A scan after machining has started checks the outline too late. */
export function scanOrderIssues(machiningBefore: boolean): AutoScanIssue[] {
  if (!machiningBefore) return []
  return [
    scanWarning(
      "after-machining",
      "Auto-scan runs after machining operations. Move it before them to check the outline first."
    ),
  ]
}
