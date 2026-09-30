import { issueOf } from "../diagnostics"
import type { Issue } from "../diagnostics"
import type {
  ToolpathBounds,
  ToolpathBoundsResult,
} from "../compile/cutting-bounds"
import { translation } from "../geometry/frame"
import { boxRect, contains, mapRect, rectAt } from "../geometry/rect"
import type { PlateSetup } from "../plate/plate"
import { rangedSchema } from "../probing/parameters"
import { AutoScanParamsSchema } from "./params"
import type { AutoScanParams, AutoScanSpecs } from "./params"

export type AutoScanIssueCode =
  | "invalid-parameters"
  | "nothing-to-trace"
  | "outline-off-stock"
  | "after-machining"

/** Errors block NC generation or Run; warnings inform without blocking. */
export type AutoScanIssue = Issue<AutoScanIssueCode>

const scanError = issueOf<AutoScanIssueCode>("error")
const scanWarning = issueOf<AutoScanIssueCode>("warning")

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
  parameters: AutoScanSpecs
): AutoScanPlan {
  const parsed = rangedSchema(AutoScanParamsSchema, parameters).safeParse(
    params
  )
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
  const onBed = mapRect(
    boxRect<"work">(outline),
    translation<"work", "bed">([workOrigin[0], workOrigin[1]])
  )
  const stockRect = rectAt<"bed">(
    [stockAnchor[0], stockAnchor[1]],
    [stock.width, stock.depth]
  )
  if (contains(stockRect, onBed)) return []
  // The outline the scan traces, at the stock top.
  const top = stockAnchor[2] + stock.height
  return [
    scanWarning(
      "outline-off-stock",
      "The cuts reach beyond the stock as placed; the scan traces where they go.",
      {
        places: [
          {
            kind: "area",
            min: [onBed.min[0], onBed.min[1], top],
            max: [onBed.max[0], onBed.max[1], top],
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
