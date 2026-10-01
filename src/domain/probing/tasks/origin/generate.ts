import type { OriginProbing, ProbeProgram } from "../../probe"
import type { OriginParams } from "./params"
import { planOrigin } from "./rules"
import type { OriginIssue } from "./rules"
import type { PlacementContext } from "../../placement"

export type OriginGeneration =
  { ok: true; program: ProbeProgram } | { ok: false; issues: OriginIssue[] }

/**
 * The complete NC of a 3D probing operation, from its parameters and the machine's 3D probe: the
 * routine finds the corner or centre and sets the work origin there.
 */
export function generateOriginNc(
  params: OriginParams,
  context: PlacementContext,
  probing: OriginProbing
): OriginGeneration {
  const plan = planOrigin(params, context, probing.parameters)
  if (!plan.ok) return plan
  return { ok: true, program: probing.program(plan) }
}
