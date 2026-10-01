import type { NcWord } from "@/machine/contract"
import { initialModalState, nextModalState } from "../nc/modal-state"
import { codeOf, programLines } from "../nc/program-lines"
import type { ProgramLines } from "../nc/program-lines"
import type { StageRule } from "../rules/stages"

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
const spindleSpeed: StageRule<"program"> = {
  id: "spindle-speed",
  stage: "program",
  label: "Spindle speed not set",
  description:
    "A program that starts the spindle (M3) before it sets a speed with S runs at the speed set before it, and does not combine with other operations.",
  severity: "warning",
  configurable: true,
  test: ({ program }) => !unsetSpeedLines(program).length,
  locate: ({ program }) => unsetSpeedLines(program),
  explain: ({ first: { program, start } }) => {
    const [line] = unsetSpeedLines(program)
    const code = codeOf(program.blocks[line - 1].words.find(startsSpindle)!)
    const speed = start.spindleSpeed
    if (speed === null)
      return {
        problem: `${code} starts the spindle without a speed, so it runs at whatever speed the machine was left at.`,
        advice: `Set the speed with S where ${code} starts the spindle.`,
      }
    return {
      problem: `${code} starts the spindle without a speed, so it runs at the ${rpm(speed)} set before it.`,
    }
  },
  fixes: {
    offer: ({ first: { start } }) => {
      const speed = start.spindleSpeed
      return speed === null
        ? []
        : [
            {
              resolution: "replace",
              label: `Start at ${rpm(speed)}`,
              description: `Set S${speed} where the spindle starts.`,
            },
          ]
    },
    apply: (subject) => {
      const { program, start } = subject
      const speed = start.spindleSpeed
      if (speed === null) return subject
      const lines = new Set(unsetSpeedLines(program))
      const resolved = program.lines.map((line, index) => {
        const spindle = lines.has(index + 1)
          ? program.blocks[index].words.find(startsSpindle)
          : undefined
        return spindle
          ? `${line.slice(0, spindle.start)}S${speed} ${line.slice(spindle.start)}`
          : line
      })
      return { ...subject, program: programLines(resolved.join("\n")) }
    },
  },
}

/** The program rules that hold for every machine: what a program needs to stand on its own. */
export const PROGRAM_RULES: readonly StageRule<"program">[] = [spindleSpeed]
