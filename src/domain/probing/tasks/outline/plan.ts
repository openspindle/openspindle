import { issueOf } from "../../../diagnostics"
import type { Issue } from "../../../diagnostics"
import type {
  ToolpathBounds,
  ToolpathBoundsResult,
} from "../../../compile/cutting-bounds"
import { rangedSchema } from "../../parameters"
import { OutlineParamsSchema } from "./params"
import type { OutlineParams, OutlineSpecs } from "./params"

export type OutlineIssueCode = "invalid-parameters" | "nothing-to-trace"

/** What blocks generating an outline's NC; the compiler reports it. */
export type OutlineIssue = Issue<OutlineIssueCode>

const scanError = issueOf<OutlineIssueCode>("error")

/** Parameters and outline that generation can render, or what blocks it. */
export type PlannedOutline =
  | { ok: true; params: OutlineParams; outline: ToolpathBounds }
  | { ok: false; issues: OutlineIssue[] }

/**
 * Everything that prevents generating NC: the parameters, within the ranges of the machine's
 * probe (`parameters`), then something to trace.
 */
export function planOutline(
  params: OutlineParams,
  toolpath: ToolpathBoundsResult,
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
  if (!toolpath.ok)
    return {
      ok: false,
      issues: [
        scanError("nothing-to-trace", `Nothing to trace: ${toolpath.reason}`),
      ],
    }
  return { ok: true, params: parsed.data, outline: toolpath.bounds }
}
