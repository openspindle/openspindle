import { plus } from "../../../geometry/frame"
import type { Frame, Vec2, XY } from "../../../geometry/frame"
import { COORDINATE_LIMIT } from "../../../primitives"
import { PROBE_START } from "../../../probing/preview"
import type { ProbeAt, ProbeGrid } from "../../../probing/preview"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { FIRMWARE_ROUTINE, GRID, probeFields } from "./blocks"
import { isMachineTravel, scanBlocks, travelTarget } from "./scan"

/**
 * The samples of a grid from its first one, `size` from it (negative runs back along an axis)
 * with `points` along each axis, in the firmware's visiting order: Makera Z1
 * CartGridStrategy.cpp:674–698 includes both grid edges and visits alternate rows in reverse
 * order.
 */
export function gridSamples<TFrame extends Frame>(
  start: XY<TFrame>,
  [width, depth]: Vec2,
  [columns, rows]: Vec2
): XY<TFrame>[] {
  const samples: XY<TFrame>[] = []
  for (let row = 0; row < rows; row++) {
    for (let step = 0; step < columns; step++) {
      const column = row % 2 ? columns - step - 1 : step
      samples.push(
        plus(start, [
          (width * column) / (columns - 1),
          (depth * row) / (rows - 1),
        ])
      )
    }
  }
  return samples
}

/** Previews show at most this many planned samples in all. */
const MAX_POINTS = 10000

/**
 * A grid as its block writes it, `offset` from where the probe starts and in that frame; null
 * for one the firmware refuses, one beyond the machine's coordinates, and one of more samples
 * than `room`.
 */
function gridFrom<TFrame extends "probe" | "machine">(
  { frame, at }: ProbeAt<TFrame>,
  offset: Vec2,
  values: ReadonlyMap<string, number>,
  sourceLine: number,
  room: number
): ProbeGrid<TFrame> | null {
  const [width, depth, columns, rows] = ["A", "B", "I", "J"].map((letter) =>
    values.get(letter)!
  )
  const start = plus(at, offset)
  if (
    ![...start, width, depth].every(
      (value) => Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT
    ) ||
    !width ||
    !depth ||
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 2 ||
    rows < 2 ||
    columns * rows > room
  )
    return null
  const size: Vec2 = [width, depth]
  const points: Vec2 = [columns, rows]
  return {
    sourceLine,
    frame,
    start,
    size,
    points,
    samples: gridSamples(start, size, points),
    clearance: values.get("H") ?? null,
  }
}

/**
 * Planned XY samples only, never measured heights or inferred Z strokes.
 * Makera Z1 CartGridStrategy.cpp:586–630 uses explicit R1/XYAB/IJ values in mm;
 * gridSamples follows its sample order.
 * X/Y offset the current probe start. Only an immediately preceding explicit
 * G53 XY move establishes that start in machine coordinates. Initial contact
 * cycles and unknown machine Z travel are not fabricated as grid samples.
 * The firmware's own auto-leveling (M495 with A/B/I/J) probes the same grid from its
 * X Y; only right after such a G53 travel is that on the bed.
 */
export function g32Grids(
  program: GCodeProgram
): ProbeGrid<"probe" | "machine">[] {
  const grids: ProbeGrid<"probe" | "machine">[] = []
  let pointCount = 0
  let scale: number | null = null
  let machineStart: XY<"machine"> | null = null
  for (const block of scanBlocks(program)) {
    const positionedStart = machineStart
    machineStart = null
    if (!block) continue
    const { words, gCodes, mCodes } = block
    // Of G20 and G21 in one block, the later one sets the units.
    for (const code of gCodes) {
      if (code === 20) scale = 25.4
      if (code === 21) scale = 1
    }
    // Only a complete, immediately preceding G53 XY move establishes a known
    // physical start. Do not infer positions through macros, pauses or work moves.
    if (isMachineTravel(block)) {
      const target = travelTarget(block, scale)
      if (target && words.filter(({ letter }) => letter === "Z").length <= 1)
        machineStart = target
      continue
    }
    // The firmware's own auto-leveling starts at its X Y in work coordinates, known on the
    // bed only where a G53 travel has just put the probe there.
    const automation =
      !gCodes.length && mCodes.length === 1 && mCodes[0] === FIRMWARE_ROUTINE
    if (automation && !positionedStart) continue
    if (
      !automation &&
      (gCodes.length !== 1 || gCodes[0] !== GRID || mCodes.length)
    )
      continue
    const values = probeFields(
      words,
      automation
        ? ["N", "M", "X", "Y", "A", "B", "I", "J", "H"]
        : ["N", "G", "R", "X", "Y", "A", "B", "I", "J", "H"]
    )
    if (
      !values ||
      (!automation && values.get("R") !== 1) ||
      !["X", "Y", "A", "B", "I", "J"].every((letter) => values.has(letter))
    )
      continue
    const from: ProbeAt<"probe" | "machine"> = positionedStart
      ? { frame: "machine", at: positionedStart }
      : PROBE_START
    const grid = gridFrom(
      from,
      // M495's X Y is where the travel already is; G32's is an offset from there.
      automation ? [0, 0] : [values.get("X")!, values.get("Y")!],
      values,
      block.line,
      MAX_POINTS - pointCount
    )
    if (!grid) continue
    grids.push(grid)
    pointCount += grid.samples.length
  }
  return grids
}
