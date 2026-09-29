/**
 * The 3D probe's routines in the Z1's NC: their subcodes, and the routine a line runs as the
 * firmware reads it, which sections and the preview find in any NC file. Combining operations
 * checks them by number (`readZ1Block`), where M480.10 reads as M480.1.
 */
import { readNcBlock } from "@/machine/contract"
import type { NcWord } from "@/machine/contract"
import type { Probe3dCorner, Probe3dRoutine } from "../../../probe-3d/params"

/** The firmware's 3D probing routines (ATCHandler's M480). */
export const ORIGIN_ROUTINE = 480

/**
 * The routine each subcode runs: 1 to 4 find an outside corner and 5 to 8 an inside one (back
 * left, back right, front right, front left), 9 a pocket's centre and 10 a boss's.
 */
const SUBCODES: Readonly<
  Record<number, { routine: Probe3dRoutine; corner?: Probe3dCorner }>
> = {
  1: { routine: "outside-corner", corner: "back-left" },
  2: { routine: "outside-corner", corner: "back-right" },
  3: { routine: "outside-corner", corner: "front-right" },
  4: { routine: "outside-corner", corner: "front-left" },
  5: { routine: "inside-corner", corner: "back-left" },
  6: { routine: "inside-corner", corner: "back-right" },
  7: { routine: "inside-corner", corner: "front-right" },
  8: { routine: "inside-corner", corner: "front-left" },
  9: { routine: "pocket-center" },
  10: { routine: "boss-center" },
}

/** The subcode that runs a routine. */
export function routineSubcode(
  routine: Probe3dRoutine,
  corner: Probe3dCorner
): number {
  const [subcode] = Object.entries(SUBCODES).find(
    ([, each]) =>
      each.routine === routine && (!each.corner || each.corner === corner)
  )!
  return Number(subcode)
}

type Words = readonly Pick<NcWord, "letter" | "value">[]

/**
 * Whether a block runs one of the routines. As a number M480.10 is M480.1, so this cannot tell
 * which: `routineOf` reads the block as written.
 */
export const runsOriginRoutine = (words: Words) =>
  words.some(
    ({ letter, value }) =>
      letter === "M" &&
      Math.trunc(value) === ORIGIN_ROUTINE &&
      value !== ORIGIN_ROUTINE
  )

/**
 * The routine a line runs, and its subcode, from its M480 word as written: the firmware reads the
 * digits after the point as a whole number, so M480.10 is the boss's and M480.1 a corner's. Null
 * for any other line or subcode.
 */
export function routineOf(line: string): {
  subcode: number
  routine: Probe3dRoutine
  corner?: Probe3dCorner
} | null {
  const block = readNcBlock(line)
  const word = block.words.find(
    ({ letter, value }) =>
      letter === "M" && Math.trunc(value) === ORIGIN_ROUTINE
  )
  if (!word || block.problem) return null
  const written = /\.(\d+)$/.exec(line.slice(word.start, word.end))
  const subcode = written ? Number(written[1]) : null
  const routine = subcode === null ? undefined : SUBCODES[subcode]
  return subcode !== null && routine ? { subcode, ...routine } : null
}
