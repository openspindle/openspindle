import type { NcWord } from "@/machine/contract"
import { ARC_PLANES, radiusArcCentre } from "@/domain/nc/gcode"
import { initialModalState, nextModalState } from "@/domain/nc/modal-state"
import {
  codeOf,
  dropWords,
  editWords,
  linesWith,
  programLines,
} from "@/domain/nc/program-lines"
import type { ProgramLines } from "@/domain/nc/program-lines"
import { IGNORE } from "@/domain/design-rules/program-rules"
import type { ProgramRule } from "@/domain/design-rules/program-rules"
import type { RuleSeverity } from "@/domain/design-rules/rules"

/** A word as the fixes write it: up to four decimals, without trailing zeros. */
const word = (letter: string, value: number) =>
  `${letter}${Number(value.toFixed(4)) || 0}`

const isCode = (letter: string, value: number) => (item: NcWord) =>
  item.letter === letter && item.value === value

/** A list of codes in a sentence: "G40 and G49", "G40, G49 and G80". */
function codesText(codes: readonly string[]): string {
  const last = codes.at(-1) ?? ""
  return codes.length > 1
    ? `${codes.slice(0, -1).join(", ")} and ${last}`
    : last
}

/** The distinct codes among `candidates` a program uses, in the order given. */
function usedCodes(program: ProgramLines, candidates: readonly string[]) {
  const used = new Set<string>()
  for (const block of program.blocks)
    if (!block.problem)
      for (const item of block.words) {
        const code = codeOf(item)
        if (candidates.includes(code)) used.add(code)
      }
  return candidates.filter((code) => used.has(code))
}

/** A rule that finds some codes and offers to drop them, with words that go with them. */
function dropRule({
  id,
  label,
  description,
  severity,
  codes,
  withLetters = [],
  problem,
  dropLabel,
  dropDescription,
}: {
  id: string
  label: string
  description: string
  severity: RuleSeverity
  codes: readonly string[]
  /** Words that belong to the codes, dropped from their blocks too: G43's H. */
  withLetters?: readonly string[]
  /** The problem, with the codes the program uses: "G40 and G49", and how many there are. */
  problem: (codes: string, count: number) => string
  /** What dropping does, with the codes the program uses. */
  dropLabel: (codes: readonly string[]) => string
  dropDescription: string
}): ProgramRule {
  const matches = (item: NcWord) => codes.includes(codeOf(item))
  return {
    id,
    label,
    description,
    severity,
    find: (program) => {
      const lines = linesWith(program, matches)
      if (!lines.length) return null
      const used = usedCodes(program, codes)
      return {
        rule: id,
        problem: problem(codesText(used), used.length),
        lines,
        choices: [
          {
            resolution: "drop",
            label: dropLabel(used),
            description: dropDescription,
          },
          IGNORE,
        ],
      }
    },
    resolve: (program) =>
      dropWords(
        program,
        (item, block) =>
          matches(item) ||
          (withLetters.includes(item.letter) && block.words.some(matches))
      ),
  }
}

const spindleReverse: ProgramRule = {
  id: "spindle-reverse",
  label: "Spindle reverse (M4)",
  description:
    "The Z1's spindle turns clockwise only. It ignores M4, so the spindle stays off while the program cuts.",
  severity: "error",
  find: (program) => {
    const lines = linesWith(program, isCode("M", 4))
    if (!lines.length) return null
    return {
      rule: "spindle-reverse",
      problem: "The Z1 ignores M4, so the spindle stays off.",
      lines,
      choices: [
        {
          resolution: "replace",
          label: "Replace with M3",
          description: "Start the spindle clockwise instead.",
        },
        {
          resolution: "drop",
          label: "Drop M4",
          description: "The spindle stays off.",
        },
        IGNORE,
      ],
    }
  },
  resolve: (program, resolution) =>
    program.lines.map((line, index) => {
      const block = program.blocks[index]
      const edits = block.problem
        ? []
        : block.words.filter(isCode("M", 4)).map((item) => ({
            word: item,
            text: resolution === "replace" ? "M3" : "",
          }))
      return edits.length ? editWords(line, edits) : line
    }),
}

const relativeCentres = dropRule({
  id: "relative-arc-centres",
  label: "Relative arc centres (G91.1)",
  description:
    "The Z1 reads G91.1 as G91, so the moves after it are taken as distances. Its arc centres are always offsets from the arc's start, which G91.1 asks for.",
  severity: "error",
  codes: ["G91.1"],
  problem: () =>
    "The Z1 reads G91.1 as G91, so the moves after it are taken as distances.",
  dropLabel: () => "Drop G91.1",
  dropDescription: "Arc centres stay offsets and moves stay absolute.",
})

/**
 * Each arc's centre as an offset from where it starts: arcs given by R get the centre their
 * radius describes, and with `absolute`, centres given as positions (G90.1) are converted.
 * Arcs whose start is unknown, or whose radius cannot reach, stay as they are.
 */
function centreOffsets(
  program: ProgramLines,
  convert: "radius" | "absolute"
): string[] {
  let state = initialModalState()
  return program.lines.map((line, index) => {
    const block = program.blocks[index]
    const before = state
    state = nextModalState(state, block)
    if (block.problem) return line
    const motion = state.motion
    if (motion !== 2 && motion !== 3) return line
    const plane = ARC_PLANES[state.plane ?? 17]
    const [centreU, centreV] = plane.centre
    const start = before.position
    const end = state.position
    if (![...start, ...end].every(Number.isFinite)) return line
    if (convert === "radius") {
      const radius = block.words.find((item) => item.letter === "R")
      const hasCentre = block.words.some((item) =>
        ["I", "J", "K"].includes(item.letter)
      )
      if (!radius || hasCentre) return line
      const centre = radiusArcCentre(
        start,
        end,
        radius.value,
        motion === 2,
        plane
      )
      if (!centre) return line
      const [u, v] = plane.axes
      return editWords(line, [
        {
          word: radius,
          text: `${word(centreU, centre[0] - start[u])} ${word(centreV, centre[1] - start[v])}`,
        },
      ])
    }
    // A G90.1 on the arc's own block applies to it.
    if (!state.absoluteCentres) return line
    const axisOf = { I: 0, J: 1, K: 2 } as const
    const edits = block.words
      .filter(
        (item): item is NcWord & { letter: "I" | "J" | "K" } =>
          item.letter === "I" || item.letter === "J" || item.letter === "K"
      )
      .map((item) => ({
        word: item,
        text: word(item.letter, item.value - start[axisOf[item.letter]]),
      }))
    return edits.length ? editWords(line, edits) : line
  })
}

const absoluteCentres: ProgramRule = {
  id: "absolute-arc-centres",
  label: "Absolute arc centres (G90.1)",
  description:
    "The Z1 reads G90.1 as G90 and always takes I, J and K as offsets from the arc's start, so arcs after it turn around the wrong centre.",
  severity: "error",
  find: (program) => {
    const lines = linesWith(program, isCode("G", 90.1))
    if (!lines.length) return null
    return {
      rule: "absolute-arc-centres",
      problem:
        "The Z1 takes I, J and K as offsets, so arcs after G90.1 turn around the wrong centre.",
      lines,
      choices: [
        {
          resolution: "replace",
          label: "Convert the arc centres",
          description:
            "Give each arc after it its centre as an offset from its start, and drop G90.1.",
        },
        IGNORE,
      ],
    }
  },
  resolve: (program) =>
    dropWords(
      // Read again: the conversion moved the words of the lines it rewrote.
      programLines(centreOffsets(program, "absolute").join("\n")),
      isCode("G", 90.1)
    ),
}

/** Lines of arcs given by R alone, in G2 or G3 set on their block or before it. */
function radiusArcLines(program: ProgramLines): number[] {
  const lines: number[] = []
  let state = initialModalState()
  program.blocks.forEach((block, index) => {
    state = nextModalState(state, block)
    if (
      !block.problem &&
      (state.motion === 2 || state.motion === 3) &&
      block.words.some((item) => item.letter === "R") &&
      !block.words.some((item) => ["I", "J", "K"].includes(item.letter))
    )
      lines.push(index + 1)
  })
  return lines
}

const radiusArcs: ProgramRule = {
  id: "radius-arcs",
  label: "Arcs given by a radius (R)",
  description:
    "The Z1 takes an arc's centre only from I, J and K, so an arc given by R has no centre.",
  severity: "error",
  find: (program) => {
    const lines = radiusArcLines(program)
    if (!lines.length) return null
    return {
      rule: "radius-arcs",
      problem:
        "The Z1 takes an arc's centre only from I, J and K, so arcs given by R have none.",
      lines,
      choices: [
        {
          resolution: "replace",
          label: "Replace R with I, J and K",
          description: "Give each arc the centre its radius describes.",
        },
        IGNORE,
      ],
    }
  },
  resolve: (program) => centreOffsets(program, "radius"),
}

const modeCancels = dropRule({
  id: "mode-cancels",
  label: "Mode cancels (G40, G49, G80)",
  description:
    "G40, G49 and G80 cancel cutter compensation, tool length offsets and canned cycles. The Z1 has none of them and does nothing with these codes, but operations that contain them do not combine.",
  severity: "warning",
  codes: ["G40", "G49", "G80"],
  problem: (codes, count) =>
    count === 1
      ? `${codes} does nothing on the Z1, but an operation with it does not combine with others.`
      : `${codes} do nothing on the Z1, but an operation with them does not combine with others.`,
  dropLabel: (codes) => `Drop ${codesText(codes)}`,
  dropDescription: "Nothing the machine does changes.",
})

const toolLengthOffsets = dropRule({
  id: "tool-length-offsets",
  label: "Tool length offsets (G43)",
  description:
    "The Z1 measures each tool at its tool change and applies its length itself. It does not know G43.",
  severity: "warning",
  codes: ["G43"],
  withLetters: ["H"],
  problem: () =>
    "The Z1 does not know G43: it measures each tool at its tool change instead.",
  dropLabel: () => "Drop G43 and H",
  dropDescription: "Moves on the same lines run as programmed.",
})

const cutterCompensation = dropRule({
  id: "cutter-compensation",
  label: "Cutter compensation (G41, G42)",
  description:
    "The Z1 has no cutter radius compensation: it cuts the programmed path, not one offset by the tool's radius.",
  severity: "warning",
  codes: ["G41", "G42"],
  withLetters: ["D"],
  problem: () =>
    "The Z1 has no cutter compensation: it cuts the programmed path, not one offset by the tool's radius.",
  dropLabel: (codes) => `Drop ${codesText([...codes, "D"])}`,
  dropDescription: "The path is cut as programmed.",
})

/** What the Z1 does not run as written: its design rules for the programs it runs. */
export const Z1_PROGRAM_RULES: readonly ProgramRule[] = [
  spindleReverse,
  relativeCentres,
  absoluteCentres,
  radiusArcs,
  modeCancels,
  toolLengthOffsets,
  cutterCompensation,
]
