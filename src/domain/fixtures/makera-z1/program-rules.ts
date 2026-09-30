import type { NcWord, RuleSeverity } from "@/machine/contract"
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
import type { ProgramSubject, StageRule } from "@/domain/rules/stages"
import { MAKERA_Z1_ID } from "./makera-z1"

/** A word as the fixes write it: up to four decimals, without trailing zeros. */
const word = (letter: string, value: number) =>
  `${letter}${Number(value.toFixed(4)) || 0}`

const isCode = (letter: string, value: number) => (item: NcWord) =>
  item.letter === letter && item.value === value

/** A program with its lines changed by a fix; lines keep their numbers. */
const withLines = (
  subject: ProgramSubject,
  lines: readonly string[]
): ProgramSubject => ({ ...subject, program: programLines(lines.join("\n")) })

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
}): StageRule<"program"> {
  const matches = (item: NcWord) => codes.includes(codeOf(item))
  return {
    id,
    stage: "program",
    label,
    description,
    severity,
    configurable: true,
    machines: [MAKERA_Z1_ID],
    test: ({ program }) => !linesWith(program, matches).length,
    locate: ({ program }) => linesWith(program, matches),
    explain: ({ first }) => {
      const used = usedCodes(first.program, codes)
      return { problem: problem(codesText(used), used.length) }
    },
    fixes: {
      offer: ({ first }) => [
        {
          resolution: "drop",
          label: dropLabel(usedCodes(first.program, codes)),
          description: dropDescription,
        },
      ],
      apply: (subject) =>
        withLines(
          subject,
          dropWords(
            subject.program,
            (item, block) =>
              matches(item) ||
              (withLetters.includes(item.letter) && block.words.some(matches))
          )
        ),
    },
  }
}

const spindleReverse: StageRule<"program"> = {
  id: "spindle-reverse",
  stage: "program",
  label: "Spindle reverse (M4)",
  description:
    "The Z1's spindle turns clockwise only. It ignores M4, so the spindle stays off while the program cuts.",
  severity: "error",
  configurable: true,
  machines: [MAKERA_Z1_ID],
  test: ({ program }) => !linesWith(program, isCode("M", 4)).length,
  locate: ({ program }) => linesWith(program, isCode("M", 4)),
  explain: () => ({ problem: "The Z1 ignores M4, so the spindle stays off." }),
  fixes: {
    offer: () => [
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
    ],
    apply: (subject, { resolution }) =>
      withLines(
        subject,
        subject.program.lines.map((line, index) => {
          const block = subject.program.blocks[index]
          const edits = block.problem
            ? []
            : block.words.filter(isCode("M", 4)).map((item) => ({
                word: item,
                text: resolution === "replace" ? "M3" : "",
              }))
          return edits.length ? editWords(line, edits) : line
        })
      ),
  },
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

const absoluteCentres: StageRule<"program"> = {
  id: "absolute-arc-centres",
  stage: "program",
  label: "Absolute arc centres (G90.1)",
  description:
    "The Z1 reads G90.1 as G90 and always takes I, J and K as offsets from the arc's start, so arcs after it turn around the wrong centre.",
  severity: "error",
  configurable: true,
  machines: [MAKERA_Z1_ID],
  test: ({ program }) => !linesWith(program, isCode("G", 90.1)).length,
  locate: ({ program }) => linesWith(program, isCode("G", 90.1)),
  explain: () => ({
    problem:
      "The Z1 takes I, J and K as offsets, so arcs after G90.1 turn around the wrong centre.",
  }),
  fixes: {
    offer: () => [
      {
        resolution: "replace",
        label: "Convert the arc centres",
        description:
          "Give each arc after it its centre as an offset from its start, and drop G90.1.",
      },
    ],
    apply: (subject) =>
      withLines(
        subject,
        dropWords(
          // Read again: the conversion moved the words of the lines it rewrote.
          programLines(centreOffsets(subject.program, "absolute").join("\n")),
          isCode("G", 90.1)
        )
      ),
  },
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

const radiusArcs: StageRule<"program"> = {
  id: "radius-arcs",
  stage: "program",
  label: "Arcs given by a radius (R)",
  description:
    "The Z1 takes an arc's centre only from I, J and K, so an arc given by R has no centre.",
  severity: "error",
  configurable: true,
  machines: [MAKERA_Z1_ID],
  test: ({ program }) => !radiusArcLines(program).length,
  locate: ({ program }) => radiusArcLines(program),
  explain: () => ({
    problem:
      "The Z1 takes an arc's centre only from I, J and K, so arcs given by R have none.",
  }),
  fixes: {
    offer: () => [
      {
        resolution: "replace",
        label: "Replace R with I, J and K",
        description: "Give each arc the centre its radius describes.",
      },
    ],
    apply: (subject) =>
      withLines(subject, centreOffsets(subject.program, "radius")),
  },
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

const erasesStoredData = dropRule({
  id: "erase-stored-data",
  label: "Erase stored tool data (M498.2)",
  description:
    "M498.2 zeroes the tool number, the tool lengths and the G54 offsets the Z1 saves: the work zero and the tool reference probing set are lost.",
  severity: "error",
  codes: ["M498.2"],
  problem: () => "M498.2 erases the tool data and work offsets the Z1 saves.",
  dropLabel: () => "Drop M498.2",
  dropDescription: "Nothing the machine cuts changes.",
})

/**
 * The firmware's own commands (SimpleShell, Configurator) that change what the Z1 keeps, or play
 * a file outside Run, each with what it does.
 */
const FIRMWARE_COMMANDS: Readonly<Record<string, string>> = {
  rm: "deletes a file on the Z1's storage",
  mv: "renames a file on the Z1's storage",
  "config-set": "changes a setting the Z1 stores",
  "config-load": "reloads the settings the Z1 stores",
  fset: "changes the Z1's factory settings",
  dfu: "puts the Z1 into firmware update mode",
  play: "plays a file on the Z1 outside Run",
}

/** The firmware command a line holds, as the shell reads its first word; null for NC. */
function firmwareCommand(program: ProgramLines, index: number) {
  if (program.blocks[index].problem !== "syntax") return null
  const name = program.lines[index].trim().split(/\s+/)[0].toLowerCase()
  return Object.hasOwn(FIRMWARE_COMMANDS, name) ? name : null
}

/** The lines that hold a firmware command. */
const firmwareCommandLines = (program: ProgramLines) =>
  program.lines.flatMap((_line, index) =>
    firmwareCommand(program, index) === null ? [] : [index + 1]
  )

const firmwareCommands: StageRule<"program"> = {
  id: "firmware-commands",
  stage: "program",
  label: "Firmware commands (rm, config-set, play)",
  description:
    "The Z1's own commands that delete or rename files on its storage, change its settings or factory settings, start firmware update mode or play a file outside Run.",
  severity: "error",
  configurable: true,
  machines: [MAKERA_Z1_ID],
  test: ({ program }) => !firmwareCommandLines(program).length,
  locate: ({ program }) => firmwareCommandLines(program),
  explain: ({ first: { program } }) => {
    const [line] = firmwareCommandLines(program)
    const name = firmwareCommand(program, line - 1)!
    return { problem: `${name} ${FIRMWARE_COMMANDS[name]}.` }
  },
  fixes: {
    offer: ({ count }) => [
      {
        resolution: "drop",
        label: count === 1 ? "Remove the command" : "Remove the commands",
        description: "Nothing the machine cuts changes.",
      },
    ],
    // Lines keep their numbers: a command's line is left empty.
    apply: (subject) =>
      withLines(
        subject,
        subject.program.lines.map((line, index) =>
          firmwareCommand(subject.program, index) === null ? line : ""
        )
      ),
  },
}

/** The Z1's program rules: what it does not run as written. */
export const Z1_RULES: readonly StageRule<"program">[] = [
  spindleReverse,
  relativeCentres,
  absoluteCentres,
  radiusArcs,
  modeCancels,
  toolLengthOffsets,
  cutterCompensation,
  erasesStoredData,
  firmwareCommands,
]
