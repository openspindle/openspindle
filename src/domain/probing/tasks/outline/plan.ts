import { issueOf } from "../../../diagnostics"
import type { Issue } from "../../../diagnostics"
import type {
  ToolpathBounds,
  ToolpathBoundsResult,
} from "../../../compile/cutting-bounds"
import { sameEdge } from "../../../plate/item-edges"
import type { ItemEdge } from "../../../plate/item-edges"
import { plural } from "../../../primitives"
import { rangedSchema } from "../../parameters"
import { OutlineParamsSchema, outlineTarget } from "./params"
import type { OutlineParams, OutlineSpecs } from "./params"

export type OutlineIssueCode =
  "invalid-parameters" | "nothing-to-trace" | "no-edges" | "edge-missing"

/** What blocks generating an outline's NC; the compiler reports it. */
export type OutlineIssue = Issue<OutlineIssueCode>

const scanError = issueOf<OutlineIssueCode>("error")

/** What a planned outline traces: a rectangle in work coordinates, or edges on the bed. */
export type PlannedTrace =
  | { readonly kind: "toolpath"; readonly bounds: ToolpathBounds }
  | { readonly kind: "edges"; readonly edges: readonly ItemEdge[] }

/** Parameters and trace that generation can render, or what blocks it. */
export type PlannedOutline =
  | { ok: true; params: OutlineParams; trace: PlannedTrace }
  | { ok: false; issues: OutlineIssue[] }

/** What an outline is traced from: the plate's toolpath bounds, and its items' edges. */
export type OutlineInputs = {
  readonly toolpath: () => ToolpathBoundsResult
  readonly edges: () => readonly ItemEdge[]
}

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * probe (`parameters`), then something to trace: the toolpath bounds, or chosen edges the
 * plate still has.
 */
export function planOutline(
  params: OutlineParams,
  inputs: OutlineInputs,
  parameters: OutlineSpecs
): PlannedOutline {
  const parsed = rangedSchema(OutlineParamsSchema, parameters).safeParse(params)
  if (!parsed.success)
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) =>
        scanError("invalid-parameters", issue.message)
      ),
    }
  const target = outlineTarget(parsed.data)
  if (target.kind === "toolpath") {
    const toolpath = inputs.toolpath()
    if (!toolpath.ok)
      return {
        ok: false,
        issues: [
          scanError(
            "nothing-to-trace",
            `Nothing to trace: ${toolpath.reason} Trace edges of the stock or fixtures instead.`
          ),
        ],
      }
    return {
      ok: true,
      params: parsed.data,
      trace: { kind: "toolpath", bounds: toolpath.bounds },
    }
  }
  if (!target.edges.length)
    return {
      ok: false,
      issues: [
        scanError(
          "no-edges",
          "Choose edges to trace: Pick edges, or Stock outline."
        ),
      ],
    }
  const available = inputs.edges()
  const edges = target.edges.map((ref) =>
    available.find((edge) => sameEdge(edge.ref, ref))
  )
  const found = edges.filter((edge) => edge !== undefined)
  const missing = edges.length - found.length
  if (missing)
    return {
      ok: false,
      issues: [
        scanError(
          "edge-missing",
          `${plural(missing, "chosen edge")} ${missing === 1 ? "is" : "are"} of something the plate no longer has on its bed, or that no longer lies flat: remove ${missing === 1 ? "it" : "them"}.`
        ),
      ],
    }
  return {
    ok: true,
    params: parsed.data,
    trace: { kind: "edges", edges: found },
  }
}
