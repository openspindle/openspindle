import { readNcBlock } from "@/machine/contract"
import type { CompiledPlate } from "@/domain/compile/compile"
import type { Plate } from "@/domain/plate/plate"
import type { Tool } from "@/domain/tools/tool"

export type ZProbeJob = {
  plateId: string
  signature: string
  connectionId: string
}
export type ZProbeCompletion = {
  connectionId: string
  signature: string
  tool: number
  offset: number
  originZ: number
  at: number
}

export function zJobSignature(
  plate: Plate,
  compiled: CompiledPlate,
  tools: readonly Tool[]
) {
  const ids = new Set(plate.tools.map((entry) => entry.toolId))
  return JSON.stringify({
    plate,
    source: compiled.program.source,
    tools: tools.filter((tool) => ids.has(tool.id)),
  })
}

/** A later program must preserve the probed surface reference. */
export function zJobIssue(
  compiled: CompiledPlate,
  probeTools: readonly number[]
): string | null {
  let selected: number | null = null
  let cutterChange = false
  for (const line of compiled.program.source.split("\n")) {
    const block = readNcBlock(line)
    const g = block.words
      .filter((word) => word.letter === "G")
      .map((word) => word.value)
    const z = block.words.some((word) => word.letter === "Z")
    const t = block.words.find((word) => word.letter === "T")
    if (t) selected = t.value
    if (block.words.some((word) => word.letter === "M" && word.value === 6))
      cutterChange =
        selected !== null && selected > 0 && !probeTools.includes(selected)
    if (
      block.words.some(
        (word) => word.letter === "M" && (word.value === 3 || word.value === 4)
      ) &&
      !cutterChange
    )
      return "Pre-job probing requires an explicit cutter change before the spindle starts."
    if (
      g.some(
        (value) =>
          (value >= 55 && value <= 59.3) ||
          [43, 43.1, 49, 92.1, 92.2, 92.3].includes(value)
      ) ||
      (z && (g.includes(10) || g.includes(92))) ||
      g.some((value) => value >= 29 && value < 39)
    )
      return "This program changes the Z reference or performs probing. Remove that setup operation before using pre-job Z probing."
  }
  if (!cutterChange)
    return "This job needs an explicit cutter change after Z probing."
  return null
}
