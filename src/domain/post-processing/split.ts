import type { NcBlock } from "@/machine/contract"
import { buildProgramSections } from "../compile/sections"
import type { SectionKind, SectionMachine } from "../compile/sections"
import { parseGCode } from "../nc/gcode"
import { initialModalState, nextModalState } from "../nc/modal-state"
import type { ModalState } from "../nc/modal-state"
import { programLines } from "../nc/program-lines"
import type { ProgramLines } from "../nc/program-lines"

export type SplitMode = "tool" | "toolpath"

/** Where one part of a split program starts, and what it is called. */
export type SplitPart = { readonly startLine: number; readonly name: string }

/**
 * A program's parts, by tool and by toolpath. A way it does not split into two parts or more
 * has none, and neither does one with a part that would start with relative moves (G91), which
 * could not start where the program left the tool.
 */
export type SplitPlan = Readonly<Record<SplitMode, readonly SplitPart[]>>

/** Sections that start a part of their own when splitting by toolpath. */
const WORK: ReadonlySet<SectionKind> = new Set([
  "toolpath",
  "probe",
  "touch-off",
  "scan",
])

/** The state before each of `starts`, ascending one-based lines. */
function statesAt(
  program: ProgramLines,
  starts: readonly number[]
): ModalState[] {
  const states: ModalState[] = []
  let state = initialModalState()
  let next = 0
  program.blocks.forEach((block, index) => {
    while (next < starts.length && starts[next] === index + 1) {
      states.push(state)
      next++
    }
    state = nextModalState(state, block)
  })
  return states
}

/** A line with nothing to run: blank, or a comment, such as a heading naming what follows. */
const isNote = (program: ProgramLines, line: number) => {
  const block = program.blocks[line - 1]
  return !block.words.length && block.delimiter === null && !block.problem
}

/**
 * Parts that split the program, or none when they would not stand on their own. Each starts
 * at the notes right before it, so a toolpath's heading goes with it.
 */
function usable(program: ProgramLines, found: SplitPart[]): SplitPart[] {
  if (found.length < 2) return []
  const parts = found.map((part, index) => {
    if (index === 0) return part
    let start = part.startLine
    while (start - 1 > found[index - 1].startLine && isNote(program, start - 1))
      start--
    return { ...part, startLine: start }
  })
  const states = statesAt(
    program,
    parts.map((part) => part.startLine)
  )
  return states.some((state) => state.distance === 91) ? [] : parts
}

const sameStarts = (a: readonly SplitPart[], b: readonly SplitPart[]) =>
  a.length === b.length &&
  a.every((part, index) => part.startLine === b[index].startLine)

/** Parts named apart: a name that comes again gets its count, "T1 (2)". */
function namedApart(parts: readonly SplitPart[]): SplitPart[] {
  const counts = new Map<string, number>()
  return parts.map((part) => {
    const count = (counts.get(part.name) ?? 0) + 1
    counts.set(part.name, count)
    return count === 1 ? part : { ...part, name: `${part.name} (${count})` }
  })
}

/**
 * A program's parts each way: at its tool changes, and at its toolpaths and probing. An update
 * finds the part an operation is among them, however importing offers to split (`splitPlan`).
 */
export function splitParts(text: string, machine: SectionMachine): SplitPlan {
  const program = programLines(text)
  const sections = buildProgramSections(parseGCode(text), machine)
  const tool = sections
    .filter((section) => section.kind === "tool-change")
    .map((section, index) => ({
      startLine: index === 0 ? 1 : section.startLine,
      name: section.tool === null ? section.name : `T${section.tool}`,
    }))
  const toolpath: SplitPart[] = []
  sections.forEach((section, index) => {
    if (!WORK.has(section.kind)) return
    // A tool change right before a toolpath goes with it.
    const previous = sections.at(index - 1)
    const start =
      index > 0 && previous?.kind === "tool-change"
        ? previous.startLine
        : section.startLine
    toolpath.push({
      startLine: toolpath.length ? start : 1,
      name: section.name,
    })
  })
  return {
    tool: namedApart(usable(program, tool)),
    toolpath: namedApart(usable(program, toolpath)),
  }
}

/** How importing offers to split a program: each way that gives parts of its own. */
export function splitPlan(text: string, machine: SectionMachine): SplitPlan {
  const { tool, toolpath } = splitParts(text, machine)
  // One toolpath per tool splits alike either way: splitting by tool says it.
  return { tool, toolpath: sameStarts(tool, toolpath) ? [] : toolpath }
}

const changesTool = (block: NcBlock) =>
  block.words.some((word) => word.letter === "M" && word.value === 6)

/**
 * What a part sets before its own lines, as the program had it where the part starts: its
 * modes, the tool and the running spindle (unless the part starts by changing tools), the feed
 * and the motion mode. Combining ends every operation with the spindle stopped, and requires
 * each to select its tool, speed and feed.
 */
function preamble(state: ModalState, blocks: readonly NcBlock[]): string[] {
  const modes = [
    state.units,
    state.distance,
    state.plane,
    state.workOffset,
  ].flatMap((code) => (code === null ? [] : [`G${code}`]))
  const lines = modes.length ? [modes.join(" ")] : []
  const first = blocks.find((block) => block.words.length && !block.problem)
  if (!first || !changesTool(first)) {
    if (state.activeTool !== null) lines.push(`T${state.activeTool} M6`)
    if (state.spindleOn && state.spindleSpeed !== null)
      lines.push(`S${state.spindleSpeed} M3`)
  }
  if (state.feed !== null) lines.push(`F${state.feed}`)
  if (state.motion !== null) lines.push(`G${state.motion}`)
  return lines
}

/** The NC of each part: from its start to the next part's, after what it must set again. */
export function splitProgram(
  text: string,
  parts: readonly SplitPart[]
): string[] {
  const program = programLines(text)
  const states = statesAt(
    program,
    parts.map((part) => part.startLine)
  )
  return parts.map((part, index) => {
    const end = parts.at(index + 1)?.startLine ?? program.lines.length + 1
    const lines = program.lines.slice(part.startLine - 1, end - 1)
    if (index === 0) return lines.join("\n")
    const blocks = program.blocks.slice(part.startLine - 1, end - 1)
    return [...preamble(states[index], blocks), ...lines].join("\n")
  })
}
