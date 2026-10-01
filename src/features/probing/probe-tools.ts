import type { Plate, PlateTool } from "@/domain/plate/plate"
import type { MachineProbing } from "@/domain/probing/strategy"
import { probeProfile } from "@/domain/tools/tool"
import type { ProbeProfile, Tool } from "@/domain/tools/tool"

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

/** "Replaces Makera Wired Probe 2.0 in T0.": what choosing a probe does to the plate's table. */
export function replacesText(
  entry: PlateTool & { readonly number: number },
  library: readonly Tool[]
): string {
  const name =
    library.find((tool) => tool.id === entry.toolId)?.name ??
    "a tool missing from the library"
  return `Replaces ${name} in T${entry.number}.`
}
