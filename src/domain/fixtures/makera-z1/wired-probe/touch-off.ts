import { PROBE_START } from "../../../probing/preview"
import type {
  PreviewFrame,
  ProbeAt,
  ProbeGrid,
  ProbeTouch,
} from "../../../probing/preview"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { FIRMWARE_ROUTINE, GRID, TOUCH_CODES } from "./blocks"
import { scanBlocks, travelTarget } from "./scan"

/** Where a grid leaves the probe: above its last sample, in its frame; undefined without one. */
function gridEnd<TFrame extends PreviewFrame>(
  grid: ProbeGrid<TFrame>
): ProbeAt<TFrame> | undefined {
  const at = grid.samples.at(-1)
  return at && { frame: grid.frame, at }
}

/**
 * Where a program's touch-offs touch, following the probe's XY: its start until the NC moves
 * it (as grids from there are drawn), a complete G53 travel's machine XY, or a grid's last
 * sample, which the firmware leaves the probe above. Tool changes return to it
 * (ATCHandler::on_main_loop); any other XY move loses it. The firmware's Z probe (M495 with O)
 * goes to its X Y in work coordinates, known on the bed only right after a G53 travel there.
 * A fast touch and the slow one after it are one touch-off.
 */
export function touchPoints(
  program: GCodeProgram,
  grids: readonly ProbeGrid<"probe" | "machine">[]
): ProbeTouch<"probe" | "machine">[] {
  const ends = new Map<number, ProbeAt<"probe" | "machine">>()
  for (const grid of grids) {
    const end = gridEnd(grid)
    if (end) ends.set(grid.sourceLine, end)
  }
  const touches: ProbeTouch<"probe" | "machine">[] = []
  // Where the probe is, or null once the NC has moved it where a preview cannot follow.
  let probe: ProbeAt<"probe" | "machine"> | null = PROBE_START
  let touched = false
  let travelled = false
  let scale: number | null = null
  for (const block of scanBlocks(program)) {
    const afterTravel = travelled
    travelled = false
    if (!block) {
      probe = null
      continue
    }
    const { line, words, gCodes, mCodes } = block
    const has = (letter: string) => words.some((word) => word.letter === letter)
    // Of G20 and G21 in one block, G21 sets the units.
    if (gCodes.includes(20)) scale = 25.4
    if (gCodes.includes(21)) scale = 1
    const end = ends.get(line)
    if (end) {
      probe = end
      touched = false
      continue
    }
    if (gCodes.includes(53)) {
      if (!has("X") && !has("Y")) continue
      const target = travelTarget(block, scale)
      probe = target && { frame: "machine", at: target }
      travelled = probe !== null
      touched = false
      continue
    }
    if (mCodes.includes(FIRMWARE_ROUTINE)) {
      probe = has("O") && afterTravel ? probe : null
      if (probe) touches.push({ sourceLine: line, ...probe })
      touched = probe !== null
      continue
    }
    if (gCodes.some((value) => TOUCH_CODES.includes(value))) {
      // A touch that moves in X or Y probes a side, not the height.
      if (has("X") || has("Y")) probe = null
      else if (probe && !touched) {
        touches.push({ sourceLine: line, ...probe })
        touched = true
      }
      continue
    }
    // Offsets and dwells never move; homing, grids and any X or Y do.
    if (gCodes.some((value) => [4, 10, 92].includes(value))) continue
    if (
      has("X") ||
      has("Y") ||
      gCodes.some((value) => [2, 3, 28, 30, GRID].includes(value))
    ) {
      probe = null
      touched = false
    }
  }
  return touches
}
