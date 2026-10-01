import { readNcBlock } from "@/machine/contract"
import type { NcWord } from "@/machine/contract"
import { MAX_PROGRAM_LINES } from "@/domain/nc/gcode"
import { fail, ok } from "../primitives"
import type { Result } from "../primitives"
import type { ProbingTask } from "../probing/strategy"

/**
 * The probing an operation's NC may do, with a probe active: none, or the probing operation's
 * task: a height grid, a touch-off that sets work Z, an outline traced without touching or a
 * corner or centre found with the 3D probe to set the work origin. The machine's kit says which
 * of its blocks each may hold.
 */
export type NcProbing = "none" | ProbingTask

/** What an operation's NC may contain beyond plain three-axis machining. */
export type NcPolicy = {
  readonly probing: NcProbing
  /**
   * Whether the operation probes from a stored anchor, and so may clear earlier height
   * compensation before it travels there.
   */
  readonly anchoredProbing: boolean
}

export const PLAIN_NC: NcPolicy = { probing: "none", anchoredProbing: false }

export type NcLine = {
  readonly original: string
  readonly words: readonly NcWord[]
  /** Index of a `%` delimiter to drop when combining. */
  readonly delimiter: number | null
}
export type NcUnit = {
  readonly lines: readonly NcLine[]
  readonly tools: readonly number[]
}
export type NcProblem = { readonly line: number; readonly message: string }

/** What combining has read of an operation's NC before a block. */
export type NcUnitState = {
  readonly policy: NcPolicy
  readonly activeTool: number | null
  readonly spindleRunning: boolean
  /** Millimetres (G21) rather than inches, and absolute distances (G90) rather than relative. */
  readonly metric: boolean
  readonly absolute: boolean
  /** How many grids the operation has probed, and how many touches it has made. */
  readonly grids: number
  readonly touches: number
}

/** What one of a machine's own blocks changes of that state; undefined leaves it. */
export type NcBlockEffect = {
  /** The motion mode after it; null when later coordinates must select their own. */
  readonly motion?: number | null
  readonly absolute?: boolean
  /** It probes a grid, or touches the surface. */
  readonly grid?: true
  readonly touch?: true
  /** It parks the machine (`NcParking`): nothing may move after it. */
  readonly park?: true
}

/**
 * A machine's own blocks beyond plain three-axis machining, such as its probe's routines and its
 * park, as combining operations reads them: what one does where it is, or why it is refused
 * there; null for a block that is not one of them (`FixtureKit.readNcBlock`).
 */
export type NcGrammar = (
  words: readonly NcWord[],
  state: NcUnitState
) => Result<NcBlockEffect> | null

/**
 * The blocks that park a machine, as the CAM made for it ends its programs
 * (`FixtureKit.isPark`). A program may park only after its last move.
 */
export type NcParking = {
  readonly isPark: (
    words: readonly Pick<NcWord, "letter" | "value">[]
  ) => boolean
}

class UnitError extends Error {}

// Deliberately limited to three-axis lines and arcs, in any plane, as the preview draws them.
// Offsets, compensation, canned cycles, macros and subprograms need a real postprocessor. Every
// operation starts in G17 again (`boundary` in compile.ts), so a plane it selects ends with it.
const G_CODES = new Set([0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 54, 90, 91, 94])
const M_CODES = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 30])
const LETTERS = new Set([
  "G",
  "M",
  "X",
  "Y",
  "Z",
  "I",
  "J",
  "K",
  "R",
  "F",
  "S",
  "T",
  "N",
  "P",
])
/** Words that move the machine or place it by an axis. */
const AXIS_LETTERS = ["X", "Y", "Z", "I", "J", "K", "R"]
/** A plain word: a letter and a number, with nothing but spaces between them. */
const PLAIN_WORD = /^[A-Z]\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/i
export const isEndWord = (word: Pick<NcWord, "letter" | "value">) =>
  word.letter === "M" && (word.value === 2 || word.value === 30)

/** A block's codes as messages name them, without its line number: `G28` for `N130 G28`. */
const codesOf = (words: readonly NcWord[]) =>
  words
    .filter((word) => word.letter !== "N")
    .map(({ letter, value }) => `${letter}${value}`)
    .join(" ")

/**
 * Where a program parks at its end: the blocks that park the machine after its last move and
 * before its end (M2/M30), as the offsets their lines start and end at, the last first. Only
 * the program's tail is read.
 */
function closingParks(
  nc: string,
  machine: NcParking
): Array<readonly [number, number]> {
  const parks: Array<readonly [number, number]> = []
  let end = nc.length
  for (;;) {
    let start = end
    while (start > 0 && nc[start - 1] !== "\n" && nc[start - 1] !== "\r")
      start--
    const block = readNcBlock(nc.slice(start, end))
    // A line that cannot run is not read past.
    if (block.problem) break
    if (block.words.length && block.message === null) {
      if (machine.isPark(block.words)) parks.push([start, end])
      else {
        // A park after the program's end never runs.
        if (block.words.some(isEndWord)) parks.length = 0
        if (block.words.some((word) => AXIS_LETTERS.includes(word.letter)))
          break
      }
    }
    if (start === 0) break
    end = start - 1
    if (nc[end] === "\n" && nc[end - 1] === "\r") end--
  }
  return parks
}

/**
 * The codes of the park a program closes with after its last move, as messages name them (`G28`
 * on the Z1); null when it closes with none.
 */
export function closingParkCodes(
  nc: string,
  machine: NcParking
): string | null {
  const parks = closingParks(nc, machine)
  if (!parks.length) return null
  // The park that ends the program; they are listed from the last.
  const [start, end] = parks[0]
  return codesOf(readNcBlock(nc.slice(start, end)).words)
}

/**
 * The program without its closing park: those lines are left empty, so the others keep their
 * numbers.
 */
export function withoutClosingPark(nc: string, machine: NcParking): string {
  let result = nc
  for (const [start, end] of closingParks(nc, machine))
    result = result.slice(0, start) + result.slice(end)
  return result
}

/**
 * Reads one operation's NC for combining with others. Anything that could not be rewritten
 * safely (macros, checksums, unsupported codes, missing tool/feed/speed setup when several
 * operations are combined) is reported with its line instead of being guessed. Blocks beyond
 * plain three-axis machining are the machine's to read (`grammar`): its probing, its park and
 * the modes its firmware ignores.
 */
export function readNcUnit(
  nc: string,
  policy: NcPolicy,
  combined: boolean,
  grammar: NcGrammar
): Result<NcUnit, NcProblem> {
  const tools = new Set<number>()
  let ended = false
  let selectedTool: number | null = null
  let activeTool: number | null = null
  let motion: number | null = null
  let feedSet = false
  let speedSet = false
  let metric = true
  let absolute = true
  let spindleRunning = false
  let grids = 0
  let touches = 0
  /** The program's first park, which nothing may move after. */
  let parked: { readonly line: number; readonly codes: string } | null = null
  const sourceLines = nc.replace(/\r\n?/g, "\n").split("\n")
  if (sourceLines.length > MAX_PROGRAM_LINES)
    return fail({ line: 1, message: "Too many source lines to combine." })
  const lines: NcLine[] = []
  for (const [index, original] of sourceLines.entries()) {
    try {
      lines.push(readLine(original, index + 1))
    } catch (problem) {
      if (problem instanceof UnitError)
        return fail({ line: index + 1, message: problem.message })
      throw problem
    }
  }
  return ok({ lines, tools: [...tools] })

  function readLine(original: string, line: number): NcLine {
    const block = readNcBlock(original)
    if (block.problem === "unmatched-comment")
      throw new UnitError(
        "Unmatched comment delimiter; correct the source before combining it."
      )
    if (block.problem === "unclosed-comment")
      throw new UnitError(
        "Unclosed comment; correct the source before combining it."
      )
    if (block.delimiter !== null)
      return { original, words: [], delimiter: block.delimiter }
    if (!block.code) return { original, words: [], delimiter: null }
    if (ended)
      throw new UnitError(
        "Executable content follows M2/M30. Split or correct the source before combining it."
      )
    if (block.problem === "block-delete")
      throw new UnitError("Optional blocks cannot be combined safely.")
    if (block.problem === "checksum")
      throw new UnitError("Checksummed NC cannot be rewritten safely.")
    // M117 text is display data, including any apparent T/M2 words in the message.
    if (block.message !== null) return { original, words: [], delimiter: null }
    if (block.problem)
      throw new UnitError(
        "Only plain NC words can be combined; macros, checksums and control flow are unsupported."
      )
    const { words } = block
    if (
      words.some(
        (word) => !PLAIN_WORD.test(original.slice(word.start, word.end))
      )
    )
      throw new UnitError(
        "Comments inside a numeric word cannot be rewritten safely."
      )
    const gCodes = words.filter((word) => word.letter === "G")
    const mCodes = words.filter((word) => word.letter === "M")
    if (
      parked !== null &&
      words.some((word) => AXIS_LETTERS.includes(word.letter))
    )
      throw new UnitError(
        `The machine moves after parking (${parked.codes}) on line ${parked.line}; a program may park only after its last move.`
      )
    // The machine's own blocks: its probe's routines, its park and modes its firmware ignores.
    const own = grammar(words, {
      policy,
      activeTool,
      spindleRunning,
      metric,
      absolute,
      grids,
      touches,
    })
    if (own) {
      if (!own.ok) throw new UnitError(own.error)
      const effect = own.value
      if (effect.motion !== undefined) motion = effect.motion
      if (effect.absolute !== undefined) absolute = effect.absolute
      if (effect.grid) grids++
      if (effect.touch) touches++
      if (effect.park) parked ??= { line, codes: codesOf(words) }
      return { original, words, delimiter: null }
    }
    const seen = new Set<string>()
    for (const word of words) {
      const { letter, value } = word
      if (
        !LETTERS.has(letter) ||
        (letter === "G" && !G_CODES.has(value)) ||
        (letter === "M" && !M_CODES.has(value))
      )
        throw new UnitError(
          `${letter}${value} is unsupported when combining operations. Export plain three-axis NC without offsets, compensation, cycles or subprograms.`
        )
      if (letter !== "G" && letter !== "M" && seen.has(letter))
        throw new UnitError(`Repeated ${letter} words are ambiguous.`)
      seen.add(letter)
      if (letter === "T") {
        if (!Number.isInteger(value) || value < 0 || value > 999999)
          throw new UnitError(
            "Tool numbers must be integers from 0 through 999999."
          )
        selectedTool = value
        tools.add(value)
      }
      if (letter === "F") {
        if (value <= 0) throw new UnitError("Feed must be greater than zero.")
        feedSet = true
      }
      if (letter === "S") {
        if (value < 0) throw new UnitError("Spindle speed cannot be negative.")
        speedSet = true
      }
      if (letter === "G" && [0, 1, 2, 3].includes(value)) motion = value
      if (letter === "G" && value === 20) metric = false
      if (letter === "G" && value === 21) metric = true
      if (letter === "G" && value === 90) absolute = true
      if (letter === "G" && value === 91) absolute = false
    }
    const endIndex = words.findIndex(isEndWord)
    if (endIndex >= 0) {
      if (endIndex !== words.length - 1)
        throw new UnitError(
          "Executable words follow M2/M30 in this block; split or correct the source."
        )
      ended = true
    }
    for (const word of mCodes) {
      if (word.value === 6) {
        if (selectedTool === null)
          throw new UnitError(
            "M6 needs an explicit tool number within this operation."
          )
        activeTool = selectedTool
      }
      if (word.value === 3 || word.value === 4) spindleRunning = true
      if (word.value === 5) spindleRunning = false
      if (combined && (word.value === 3 || word.value === 4) && !speedSet)
        throw new UnitError(
          "Set spindle speed with S before starting it in each operation."
        )
    }
    const dwell = gCodes.some((word) => word.value === 4)
    const hasAxes = words.some((word) => AXIS_LETTERS.includes(word.letter))
    if (hasAxes && !dwell) {
      if (motion === null)
        throw new UnitError(
          "Select G0, G1, G2 or G3 before coordinates in each operation."
        )
      const onlyRapidZ =
        motion === 0 &&
        !words.some((word) => ["X", "Y", "I", "J", "R"].includes(word.letter))
      if (combined && !onlyRapidZ && activeTool === null)
        throw new UnitError(
          "Select a tool with T and M6 before machining in each operation."
        )
      if (combined && motion !== 0 && !feedSet)
        throw new UnitError("Set feed with F before cutting in each operation.")
    }
    return { original, words, delimiter: null }
  }
}

/**
 * Why combining operations refuses a block, as a plain operation would write it once it has
 * selected its tool, spindle speed and feed; null when it takes the block. The G-code glossary
 * tells by it which codes combine.
 */
export function combineRefusal(
  block: string,
  grammar: NcGrammar
): string | null {
  const nc = [
    "G21 G90 G17",
    "T1 M6",
    "S10000 M3",
    "G0 X0 Y0 Z5",
    "G1 Z5 F500",
    block,
  ].join("\n")
  const unit = readNcUnit(nc, PLAIN_NC, true, grammar)
  return unit.ok ? null : unit.error.message
}
