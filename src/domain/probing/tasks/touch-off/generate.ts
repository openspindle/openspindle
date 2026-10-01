import type { ProbeProgram, TouchOff } from "../../probe"
import type { TouchOffParams } from "./params"
import { planTouchOff } from "./rules"
import type { TouchOffIssue } from "./rules"
import type { PlacementContext } from "../../placement"

export type TouchOffGeneration =
  { ok: true; program: ProbeProgram } | { ok: false; issues: TouchOffIssue[] }

/**
 * The complete touch-off NC of an auto Z-height operation, from its parameters and the
 * machine's probe: the probed surface becomes work Z0.
 */
export function generateTouchOffNc(
  params: TouchOffParams,
  context: PlacementContext,
  touchOff: TouchOff
): TouchOffGeneration {
  const plan = planTouchOff(params, context, touchOff.parameters)
  if (!plan.ok) return plan
  return {
    ok: true,
    program: touchOff.program({ params: plan.params, start: plan.start }),
  }
}
