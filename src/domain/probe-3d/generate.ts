import type { OriginProbing } from "../probing/probe"
import type { Probe3dParams } from "./params"
import { planProbe3d } from "./rules"
import type { Probe3dIssue } from "./rules"
import type { PlacementContext } from "../probing/placement"

export type Probe3dGeneration =
  { ok: true; program: { nc: string } } | { ok: false; issues: Probe3dIssue[] }

/**
 * The complete NC of a 3D probing operation, from its parameters and the machine's 3D probe: the
 * routine finds the corner or centre and sets the work origin there.
 */
export function generateProbe3dNc(
  params: Probe3dParams,
  context: PlacementContext,
  probing: OriginProbing
): Probe3dGeneration {
  const plan = planProbe3d(params, context, probing.parameters)
  if (!plan.ok) return plan
  return {
    ok: true,
    program: { nc: probing.program(plan.params, plan.start, plan.height) },
  }
}
