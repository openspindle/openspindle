import type { ProbeProgram, TouchOff } from "../probing/probe"
import type { AutoZHeightParams } from "./params"
import { planAutoZHeight } from "./rules"
import type { AutoZHeightIssue } from "./rules"
import type { PlacementContext } from "../probing/placement"

export type AutoZHeightGeneration =
  | { ok: true; program: ProbeProgram }
  | { ok: false; issues: AutoZHeightIssue[] }

/**
 * The complete touch-off NC of an auto Z-height operation, from its parameters and the
 * machine's probe: the probed surface becomes work Z0.
 */
export function generateAutoZHeightNc(
  params: AutoZHeightParams,
  context: PlacementContext,
  touchOff: TouchOff
): AutoZHeightGeneration {
  const plan = planAutoZHeight(params, context, touchOff.parameters)
  if (!plan.ok) return plan
  return {
    ok: true,
    program: touchOff.program({ params: plan.params, start: plan.start }),
  }
}
