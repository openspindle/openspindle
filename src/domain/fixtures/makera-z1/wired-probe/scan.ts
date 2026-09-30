/**
 * How the wired probe's previews read any NC file: block by block, and where a machine-coordinate
 * travel puts the probe. Each preview keeps its own track of the units and of where the probe is.
 */
import type { XY } from "../../../geometry/frame"
import { readNcBlock } from "@/machine/contract"
import type { NcWord } from "@/machine/contract"
import { MAX_PROGRAM_LINES } from "@/domain/nc/gcode"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { isAnchorXY } from "@/domain/anchors/stored-anchors"

/** A block a preview reads: its one-based line, its words, and its G and M codes in order. */
export type ScannedBlock = {
  readonly line: number
  readonly words: readonly NcWord[]
  readonly gCodes: readonly number[]
  readonly mCodes: readonly number[]
}

/**
 * The blocks of a program a preview reads, in order: those with words, but messages (M117), up
 * to the line limit and until the program ends (M2, M30). A line that cannot run as written comes
 * as null; where the probe is is lost there.
 */
export function* scanBlocks(
  program: GCodeProgram
): Generator<ScannedBlock | null> {
  for (
    let index = 0;
    index < Math.min(program.lines.length, MAX_PROGRAM_LINES);
    index++
  ) {
    const block = readNcBlock(program.lines[index])
    if (block.problem) {
      yield null
      continue
    }
    if (block.message !== null || !block.words.length) continue
    const { words } = block
    const codes = (letter: "G" | "M") =>
      words.filter((word) => word.letter === letter).map(({ value }) => value)
    const mCodes = codes("M")
    if (mCodes.some((value) => value === 2 || value === 30)) return
    yield { line: index + 1, words, gCodes: codes("G"), mCodes }
  }
}

/** A machine-coordinate travel's words: a line number, G53 G0, axes and a feed. */
const TRAVEL_LETTERS = ["N", "G", "X", "Y", "Z", "F"]

/** Whether a block is a machine-coordinate rapid (G53 G0) and nothing else. */
export const isMachineTravel = ({ gCodes, words }: ScannedBlock) =>
  gCodes.length === 2 &&
  gCodes[0] === 53 &&
  gCodes[1] === 0 &&
  words.every(({ letter }) => TRAVEL_LETTERS.includes(letter))

/**
 * Where a complete machine-coordinate travel puts the probe: the machine XY of a G53 G0 with one
 * X and one Y, in the units `scale` gives in millimetres. Null for any other block, before the
 * program sets its units (a null scale) and beyond the machine's coordinates.
 */
export function travelTarget(
  block: ScannedBlock,
  scale: number | null
): XY<"machine"> | null {
  if (scale === null || !isMachineTravel(block)) return null
  const xs = block.words.filter(({ letter }) => letter === "X")
  const ys = block.words.filter(({ letter }) => letter === "Y")
  if (xs.length !== 1 || ys.length !== 1) return null
  const target: XY<"machine"> = [xs[0].value * scale, ys[0].value * scale]
  return isAnchorXY(target) ? target : null
}
