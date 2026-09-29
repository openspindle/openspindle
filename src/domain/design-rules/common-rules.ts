import type { NcWord } from "@/machine/contract"
import type { FixtureKit } from "../fixtures/fixture-kit"
import { initialModalState, nextModalState } from "../nc/modal-state"
import { codeOf } from "../nc/program-lines"
import type { ProgramLines } from "../nc/program-lines"
import { IGNORE } from "./program-rules"
import type { ProgramRule } from "./program-rules"

const startsSpindle = (word: NcWord) =>
  word.letter === "M" && (word.value === 3 || word.value === 4)

/** The lines that start the spindle while the program has set no speed with S. */
function unsetSpeedLines(program: ProgramLines): number[] {
  const lines: number[] = []
  let state = initialModalState()
  program.blocks.forEach((block, index) => {
    state = nextModalState(state, block)
    if (
      state.spindleSpeed === null &&
      !block.problem &&
      block.message === null &&
      block.words.some(startsSpindle)
    )
      lines.push(index + 1)
  })
  return lines
}

const rpm = (speed: number) => `${speed.toLocaleString("en-US")} rpm`

/**
 * A program that starts the spindle before it sets a speed: it counts on the speed set before
 * it, as programs a CAM exports one per operation do after the first. It runs at whatever speed
 * the machine was left at, and does not combine with other operations, which each set their own.
 * Where what runs before it sets a speed, it offers to start at that speed.
 */
const spindleSpeed: ProgramRule = {
  id: "spindle-speed",
  label: "Spindle speed not set",
  description:
    "A program that starts the spindle (M3) before it sets a speed with S runs at the speed set before it, and does not combine with other operations.",
  severity: "warning",
  find: (program, start) => {
    const lines = unsetSpeedLines(program)
    if (!lines.length) return null
    const code = codeOf(program.blocks[lines[0] - 1].words.find(startsSpindle)!)
    const speed = start.spindleSpeed
    if (speed === null)
      return {
        rule: "spindle-speed",
        problem: `${code} starts the spindle without a speed, so it runs at whatever speed the machine was left at.`,
        lines,
        advice: `Set the speed with S where ${code} starts the spindle.`,
        choices: [IGNORE],
      }
    return {
      rule: "spindle-speed",
      problem: `${code} starts the spindle without a speed, so it runs at the ${rpm(speed)} set before it.`,
      lines,
      choices: [
        {
          resolution: "replace",
          label: `Start at ${rpm(speed)}`,
          description: `Set S${speed} where the spindle starts.`,
        },
        IGNORE,
      ],
    }
  },
  resolve: (program, _resolution, start) => {
    const speed = start.spindleSpeed
    if (speed === null) return program.lines
    const lines = new Set(unsetSpeedLines(program))
    return program.lines.map((line, index) => {
      const spindle = lines.has(index + 1)
        ? program.blocks[index].words.find(startsSpindle)
        : undefined
      return spindle
        ? `${line.slice(0, spindle.start)}S${speed} ${line.slice(spindle.start)}`
        : line
    })
  },
}

/** The program rules of every machine: what a program needs to stand on its own. */
export const COMMON_PROGRAM_RULES: readonly ProgramRule[] = [spindleSpeed]

/** Every rule a machine's programs are checked against: the common ones, then its own. */
export const programRulesFor = (kit: FixtureKit): readonly ProgramRule[] => [
  ...COMMON_PROGRAM_RULES,
  ...kit.programRules,
]
