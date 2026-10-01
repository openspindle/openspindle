import type { ProbingOperation } from "@/domain/operations/kinds"
import type { Plate, PlateTool } from "@/domain/plate/plate"
import { runsWith, strategyOf } from "@/domain/probing/strategies"
import type { MachineProbing } from "@/domain/probing/strategy"
import { probeProfile } from "@/domain/tools/tool"
import type { ProbeProfile, Tool } from "@/domain/tools/tool"
import { isProbeSlot } from "@/domain/tools/tool-table"

/** What a probe senses and carries, in a few words: "Touches Z · laser pointer". */
export function profileText({ touch, pointer }: ProbeProfile): string {
  const touches = touch === "xyz" ? "Touches X Y Z" : "Touches Z"
  return pointer ? `${touches} · laser pointer` : touches
}

/** The numbered table entry of the plate that holds a tool, if any. */
export function heldEntry(
  plate: Plate,
  tool: Tool
): (PlateTool & { readonly number: number }) | undefined {
  return plate.tools.find(
    (entry): entry is PlateTool & { number: number } =>
      entry.toolId === tool.id && entry.number !== null
  )
}

/**
 * The table entry a probe would take over: the number the machine's firmware needs it in, while
 * that holds another tool, which binding an operation keeps (`bindTools`). Undefined where the
 * table holds the probe or nothing there, or the machine takes a probe in any number.
 */
export function replacedEntry(
  plate: Plate,
  tool: Tool,
  machine: MachineProbing
): (PlateTool & { readonly number: number }) | undefined {
  const profile = probeProfile(tool)
  const slot = profile && machine.slot(profile)
  if (slot === null) return undefined
  return plate.tools.find(
    (entry): entry is PlateTool & { number: number } =>
      entry.number === slot && entry.toolId !== null && entry.toolId !== tool.id
  )
}

/** "Makera Wired Probe 2.0 in T0": the tool a table entry holds, and its number. */
export function entryText(
  entry: PlateTool & { readonly number: number },
  library: readonly Tool[]
): string {
  const name =
    library.find((tool) => tool.id === entry.toolId)?.name ??
    "a tool missing from the library"
  return `${name} in T${entry.number}`
}

/**
 * The other probing operations bound to a table number whose strategy could not probe with a
 * tool there, by name: those that putting the tool in that number leaves without a probe they
 * run with.
 */
export function strandedBy(
  plate: Plate,
  number: number,
  tool: Tool,
  machine: MachineProbing,
  except?: string
): string[] {
  const profile = probeProfile(tool)
  return plate.operations.flatMap((operation) => {
    const { source } = operation
    if (source.kind !== "probing" || operation.id === except) return []
    if (!operation.tools.some((binding) => binding.plate === number)) return []
    const strategy = strategyOf(source.strategy, machine)
    return strategy && !(profile && runsWith(strategy, profile, machine))
      ? [operation.name]
      : []
  })
}

/** "Outline trace cannot use it": the operations a replacement strands (`strandedBy`). */
export const strandedText = (names: readonly string[]) =>
  names.length ? `${names.join(", ")} cannot use it` : null

/** The number a probing operation selects a probe by: where the machine needs it, else its own. */
export const probeNumber = (
  operation: Pick<ProbingOperation, "source">,
  profile: ProbeProfile,
  machine: MachineProbing
): number => machine.slot(profile) ?? operation.source.probe

/**
 * The table entry that choosing a probe for a probing operation replaces for other operations
 * too, and how many of them use it: the entry of the number the operation selects the probe by
 * (`probeNumber`), while it holds another tool. Assigning puts the probe there for everyone, as
 * a probe slot is one entry per plate (`assignOperationTools`). Undefined where no other
 * operation's tool changes.
 */
export function sharedReplacement(
  plate: Plate,
  operation: Pick<ProbingOperation, "id" | "source" | "tools">,
  tool: Tool,
  machine: MachineProbing
):
  | { entry: PlateTool & { readonly number: number }; others: number }
  | undefined {
  const profile = probeProfile(tool)
  if (!profile) return undefined
  const local = probeNumber(operation, profile, machine)
  const number =
    operation.tools.find((binding) => binding.local === local)?.plate ?? local
  // Outside the probe slots, a shared entry keeps its tool and the operation moves instead.
  if (!isProbeSlot(number)) return undefined
  const entry = plate.tools.find(
    (item): item is PlateTool & { number: number } =>
      item.number === number && item.toolId !== null && item.toolId !== tool.id
  )
  const others = plate.operations.filter(
    (item) =>
      item.id !== operation.id &&
      item.tools.some((binding) => binding.plate === number)
  ).length
  return entry && others ? { entry, others } : undefined
}

/**
 * "Replaces Ruby 3D probe in T9999, which 1 other operation uses.": what choosing a probe
 * changes for the plate's other operations (`sharedReplacement`).
 */
export function sharedReplacementText(
  {
    entry,
    others,
  }: { entry: PlateTool & { readonly number: number }; others: number },
  library: readonly Tool[]
): string {
  const users =
    others === 1 ? "1 other operation uses" : `${others} other operations use`
  return `Replaces ${entryText(entry, library)}, which ${users}.`
}
