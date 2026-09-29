/**
 * The blocks of the wired probe's NC on the Z1, read the same way wherever they are read:
 * combining operations checks them (`readZ1Block`), sections and previews find them in any NC
 * file.
 */
import type { NcBlock, NcWord } from "@/machine/contract"
import type { ProbingSections } from "../../../probing/probe"
import { PROBE_3D_TOOL } from "../../../tools/tool-table"
import { runsOriginRoutine } from "../3d-probe/blocks"

/** The firmware's own routines (ATCHandler's M495): its Z probe, and its auto-leveling grid. */
export const FIRMWARE_ROUTINE = 495
/** The rectangular grid the firmware probes and compensates with (CartGridStrategy's G32). */
export const GRID = 32
/** Straight probing moves that stop at a touch. */
export const TOUCH_CODES: readonly number[] = [38.2, 38.3, 38.4, 38.5]
/** M370 clears height compensation; M494, M494.1 and M494.2 switch the probe's indicator. */
export const PROBE_SETUP_CODES: readonly number[] = [370, 494, 494.1, 494.2]

type Words = readonly Pick<NcWord, "letter" | "value">[]

const hasCode = (words: Words, letter: "G" | "M", code: number) =>
  words.some((word) => word.letter === letter && word.value === code)
const hasLetter = (words: Words, letter: string) =>
  words.some((word) => word.letter === letter)

/**
 * A probing block's words by letter, when every one is `allowed` and none repeats but G; null
 * otherwise. Probing blocks carry every value they need explicitly.
 */
export function probeFields(
  words: Words,
  allowed: readonly string[]
): Map<string, number> | null {
  const values = new Map<string, number>()
  for (const { letter, value } of words) {
    if (!allowed.includes(letter) || (letter !== "G" && values.has(letter)))
      return null
    values.set(letter, value)
  }
  return values
}

/** The firmware's own probing (M495): its Z probe has an O offset, its grid an A size. */
const firmwareProbing = (words: Words, letter: "O" | "A") =>
  hasCode(words, "M", FIRMWARE_ROUTINE) && hasLetter(words, letter)

/** Whether a block probes a grid: G32, or the firmware's auto-leveling. */
const probesGrid = (words: Words) =>
  hasCode(words, "G", GRID) || firmwareProbing(words, "A")

/** Whether a block touches: a straight probing move, the firmware's Z probe or its 3D probing. */
const touches = (words: Words) =>
  words.some(
    (word) => word.letter === "G" && TOUCH_CODES.includes(word.value)
  ) ||
  firmwareProbing(words, "O") ||
  runsOriginRoutine(words)

/**
 * Blocks that continue a touch-off once one has started: further touches, setting a work offset
 * from the touch (G10 L20), mode changes, Z-only rapids (backing off, lifting) and the probe
 * indicator (M494).
 */
function continuesTouchOff({ words }: NcBlock): boolean {
  if (touches(words)) return true
  if (
    hasCode(words, "G", 10) &&
    words.some(({ letter, value }) => letter === "L" && value === 20)
  )
    return true
  if (
    words.length &&
    words.every((word) => word.letter === "M" || word.letter === "N") &&
    words.some((word) => word.letter === "M" && Math.trunc(word.value) === 494)
  )
    return true
  return (
    words.length > 0 &&
    words.every(
      (word) =>
        (word.letter === "G" && [0, 90, 91].includes(word.value)) ||
        word.letter === "Z" ||
        word.letter === "N"
    )
  )
}

/**
 * The 3D probe's touch-offs, and the firmware's 3D probing, find a work origin; a touch-off that
 * probes along Z only, or the firmware's Z probe, sets a height; others touch a side.
 */
function touchOffName(words: Words, tool: number | null) {
  if (tool === PROBE_3D_TOOL || runsOriginRoutine(words)) return "3D probing"
  return !firmwareProbing(words, "O") &&
    words.some((word) => word.letter === "X" || word.letter === "Y")
    ? "Touch-off"
    : "Z-height probing"
}

/** How the Z1's probing reads in a program's sections. */
export const WIRED_PROBE_SECTIONS: ProbingSections = {
  probesGrid: ({ words }) => probesGrid(words),
  touchOff: ({ words }, tool) =>
    touches(words) ? touchOffName(words, tool) : null,
  continuesTouchOff,
}
