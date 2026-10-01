import type { GridProbing, ProbeProgram } from "../../probe"
import type { GridParams } from "./params"
import { planGrid } from "./rules"
import type { GridIssue } from "./issues"
import type { PlacementContext } from "../../placement"

export type GridGeneration =
  { ok: true; program: ProbeProgram } | { ok: false; issues: GridIssue[] }

/** The complete probing NC of an auto-level operation, from its parameters and the machine's probe. */
export function generateGridNc(
  params: GridParams,
  context: PlacementContext,
  probing: GridProbing
): GridGeneration {
  const plan = planGrid(params, context, probing.parameters)
  if (!plan.ok) return plan
  return {
    ok: true,
    program: probing.program({ params: plan.params, start: plan.start }),
  }
}
