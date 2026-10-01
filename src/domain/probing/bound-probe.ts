import type { Operation, ProbingSource } from "../operations/operation"
import type { Plate } from "../plate/plate"
import { capitalize, fail, ok, toolNumberText } from "../primitives"
import type { Result } from "../primitives"
import { probeProfile } from "../tools/tool"
import type { Tool } from "../tools/tool"
import type { BoundProbe, MachineProbing, TaskStrategy } from "./strategy"

/**
 * Why a probing operation has no probe its strategy can run with, and the plate's table entry
 * that assigning another tool to fixes, if any.
 */
export type ProbeFailure = {
  readonly message: string
  readonly toolNumber?: number
}

/**
 * The probe a probing operation selects, as its plate's table holds it: the operation's binding
 * of its probe number, the table entry that binding maps it to, and the library tool the entry
 * holds, among `tools`. The tool must be a probe of known profile, one the strategy runs, and in
 * the number the machine's firmware needs a probe of that profile in. The library is read only
 * through the table, as compiling's cache expects.
 */
export function boundProbe(
  operation: Operation & { readonly source: ProbingSource },
  plate: Plate,
  tools: readonly Tool[],
  strategy: TaskStrategy,
  machine: MachineProbing,
  machineName: string
): Result<BoundProbe, ProbeFailure> {
  const number = operation.source.probe
  const binding = operation.tools.find((item) => item.local === number)
  const entry =
    binding && plate.tools.find((tool) => tool.number === binding.plate)
  if (!binding || !entry)
    return fail({
      message: `${capitalize(toolNumberText(binding ? binding.plate : number))} is not in this plate's tool table.`,
    })
  const table = entry.number
  const named = capitalize(toolNumberText(table))
  const toolNumber = table ?? undefined
  if (entry.toolId === null)
    return fail({ message: `${named} has no tool assigned.`, toolNumber })
  const tool = tools.find((item) => item.id === entry.toolId)
  if (!tool)
    return fail({
      message: `${named} uses a tool that is no longer in the library.`,
      toolNumber,
    })
  const profile = probeProfile(tool)
  if (!profile)
    return fail({
      message: `${named} holds ${tool.name}, which is not a probe of known profile: assign a probe, or say what it touches in the tool library.`,
      toolNumber,
    })
  if (!strategy.accepts(profile, machine))
    return fail({
      message: `${strategy.label} cannot run with ${tool.name} in ${toolNumberText(table)}: assign a probe it runs with.`,
      toolNumber,
    })
  const slot = machine.slot(profile)
  if (slot !== null && table !== slot)
    return fail({
      message: `${tool.name} is in ${toolNumberText(table)}, but the ${machineName} needs it in T${slot}.`,
    })
  return ok({ number, tool, profile })
}
