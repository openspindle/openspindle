import { roundOutward } from "../../../compile/cutting-bounds"
import type { ToolpathBoundsResult } from "../../../compile/cutting-bounds"
import { boxRect } from "../../../geometry/rect"
import type { OutlineTrace, ProbeProgram } from "../../probe"
import type { OutlineParams } from "./params"
import { planOutline } from "./rules"
import type { OutlineIssue } from "./rules"

export type OutlineGeneration =
  { ok: true; program: ProbeProgram } | { ok: false; issues: OutlineIssue[] }

/**
 * The complete NC of an auto-scan operation: the machine's probe tracing the plate's toolpath
 * bounds, rounded outwards, with the operation's parameters.
 */
export function generateOutlineNc(
  params: OutlineParams,
  toolpath: ToolpathBoundsResult,
  trace: OutlineTrace
): OutlineGeneration {
  const plan = planOutline(params, toolpath, trace.parameters)
  if (!plan.ok) return plan
  return {
    ok: true,
    program: trace.program({
      params: plan.params,
      outline: boxRect<"work">(roundOutward(plan.outline)),
    }),
  }
}
