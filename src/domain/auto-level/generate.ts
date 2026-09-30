import type { GridProbing, ProbeProgram } from "../probing/probe"
import type { AutoLevelParams } from "./params"
import { planAutoLevel } from "./rules"
import type { AutoLevelIssue } from "./issues"
import type { PlacementContext } from "../probing/placement"

export type AutoLevelGeneration =
  { ok: true; program: ProbeProgram } | { ok: false; issues: AutoLevelIssue[] }

/** The complete probing NC of an auto-level operation, from its parameters and the machine's probe. */
export function generateAutoLevelNc(
  params: AutoLevelParams,
  context: PlacementContext,
  probing: GridProbing
): AutoLevelGeneration {
  const plan = planAutoLevel(params, context, probing.parameters)
  if (!plan.ok) return plan
  return {
    ok: true,
    program: probing.program({ params: plan.params, start: plan.start }),
  }
}
