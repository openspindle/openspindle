import { roundOutward } from "../compile/cutting-bounds"
import type { ToolpathBoundsResult } from "../compile/cutting-bounds"
import { boxRect } from "../geometry/rect"
import type { OutlineTrace, ProbeProgram } from "../probing/probe"
import type { AutoScanParams } from "./params"
import { planAutoScan } from "./rules"
import type { AutoScanIssue } from "./rules"

export type AutoScanGeneration =
  { ok: true; program: ProbeProgram } | { ok: false; issues: AutoScanIssue[] }

/**
 * The complete NC of an auto-scan operation: the machine's probe tracing the plate's toolpath
 * bounds, rounded outwards, with the operation's parameters.
 */
export function generateAutoScanNc(
  params: AutoScanParams,
  toolpath: ToolpathBoundsResult,
  trace: OutlineTrace
): AutoScanGeneration {
  const plan = planAutoScan(params, toolpath, trace.parameters)
  if (!plan.ok) return plan
  return {
    ok: true,
    program: trace.program({
      params: plan.params,
      outline: boxRect<"work">(roundOutward(plan.outline)),
    }),
  }
}
