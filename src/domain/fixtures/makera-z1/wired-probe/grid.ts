import { formatMillimetres } from "../../../auto-level/params"
import type {
  AutoLevelGridField,
  AutoLevelGridParameters,
  AutoLevelParams,
} from "../../../auto-level/params"
import type { ProbeGrid, ProbePoint } from "../../../auto-level/probe-grid"
import type { MachineStart, ProbeStart } from "../../../auto-level/rules"
import { COORDINATE_LIMIT } from "../../../primitives"
import type { GridProbing, GridShape } from "../../../probing/probe"
import { readNcBlock } from "@/machine/contract"
import { MAX_PROGRAM_LINES } from "@/domain/nc/gcode"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { isAnchorXY } from "@/domain/anchors/stored-anchors"
import { FIRMWARE_ROUTINE, GRID, probeFields } from "./blocks"
import { CLEARANCE_Z } from "./travel"

type GridWord = (field: AutoLevelGridField) => string

/**
 * The wired probe grid bounds. They are application
 * limits, not a clearance check; the included firmware configuration allows at most 15 × 15
 * points.
 */
const GRID_PARAMETERS: AutoLevelGridParameters = {
  width: {
    label: "Width",
    axis: "X",
    unit: "mm",
    default: 50,
    min: 1,
    max: 200,
    step: 0.1,
  },
  depth: {
    label: "Depth",
    axis: "Y",
    unit: "mm",
    default: 50,
    min: 1,
    max: 200,
    step: 0.1,
  },
  columns: { label: "X probe points", default: 5, min: 2, max: 15, step: 1 },
  rows: { label: "Y probe points", default: 5, min: 2, max: 15, step: 1 },
  clearance: {
    label: "Clearance height",
    axis: "Z",
    unit: "mm",
    default: 2,
    min: 0.5,
    max: 10,
    step: 0.1,
    description:
      "Firmware H value after the first surface contact; not an absolute initial Z position.",
  },
}

const INTRODUCTION = [
  "; Makera wired Probe 2.0 - rectangular auto-leveling",
  "; The firmware measures the grid and applies Z compensation.",
  "; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.",
]
const FIRMWARE_INTRODUCTION = [
  "; Makera wired Probe 2.0 - rectangular auto-leveling",
  "; The firmware's own auto-leveling (M495, as Makera Studio runs it) measures the grid,",
  "; reports every point and the height map, and applies Z compensation.",
  "; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.",
]
const POSITION_PROBE =
  "; Position probe above the lower-left grid corner; confirm initial Z and travel."
const PRECAUTIONS = [
  "; Check firmware probe speeds, maximum travel, offsets and initial_height.",
  "; Keep the entire grid and clearance moves within stock and clear of fixtures.",
  "; G32 measures real heights internally and enables compensation; no work-zero is set.",
]
const PROBE_SETUP = ["M5", "G21 G90", "M6 T0", "M494.0"]
/** M495 switches the probe's laser itself. */
const FIRMWARE_PROBE_SETUP = ["M5", "G21 G90", "M6 T0"]
const GRID_FROM_PROBE =
  "; Grid extends positive X and Y from the current probe position."
const REVIEW_PAUSE = [
  "; Review pause: check the measured height map (M375.1), then Resume or Stop.",
  "M0",
]
const CONCLUSION = [
  "; Verify successful probing in the controller before any subsequent machining.",
  "; Compensation remains active; M370 clears it when deliberately requested.",
  "M2",
]

/**
 * Ordinary queued moves, never M496's deferred main-loop action: up to the clearance, then over
 * the grid's start.
 */
function anchorTravel({ anchor, source, target }: MachineStart): string[] {
  const provenance =
    source === "factory"
      ? "FACTORY DEFAULT coordinates - verify against the device before Run"
      : "firmware configuration snapshot"
  return [
    `; Probe placement: stored anchor ${JSON.stringify(anchor.id)}; ${provenance}.`,
    "; Rises to the machine's clearance before moving in X and Y; verify homing and firmware initial_height.",
    "G21 G90",
    "; Clear previous height compensation before machine-coordinate travel.",
    "M370",
    `G53 G0 Z${formatMillimetres(CLEARANCE_Z)}`,
    `G53 G0 X${formatMillimetres(target[0])} Y${formatMillimetres(target[1])}`,
  ]
}

/** R1: X/Y offset the grid from the probe position, or from the G53 target (X0 Y0). */
function probeBlock(word: GridWord, start: ProbeStart): string {
  const [x, y] = start.kind === "probe-position" ? start.offset : [0, 0]
  return `G32 R1 X${formatMillimetres(x)} Y${formatMillimetres(y)} A${word("width")} B${word("depth")} I${word("columns")} J${word("rows")} H${word("clearance")}`
}

/**
 * The firmware's own auto-leveling (ATCHandler::fill_autolevel_scripts): over X Y in work
 * coordinates, where the G53 travel already is, then `G32 R1 X0 Y0` with the same size, points
 * and height. The firmware prints its values with three decimals, as these are.
 */
function firmwareBlock(
  size: Pick<AutoLevelParams, AutoLevelGridField>,
  [x, y]: ProbePoint
): string {
  const mm = (value: number) => String(Number(value.toFixed(3)) + 0)
  return `M495 X${mm(x)} Y${mm(y)} A${mm(size.width)} B${mm(size.depth)} I${size.columns} J${size.rows} H${mm(size.clearance)}`
}

/**
 * Samples in the firmware's visiting order. Makera Z1 CartGridStrategy.cpp:674–698 includes both
 * grid edges and visits alternate rows in reverse order.
 */
function gridSamples({
  start,
  width,
  depth,
  columns,
  rows,
}: GridShape): ProbePoint[] {
  const points: ProbePoint[] = []
  for (let row = 0; row < rows; row++) {
    for (let step = 0; step < columns; step++) {
      const column = row % 2 ? columns - step - 1 : step
      points.push([
        start[0] + (width * column) / (columns - 1),
        start[1] + (depth * row) / (rows - 1),
      ])
    }
  }
  return points
}

/** Previews show at most this many planned samples in all. */
const MAX_POINTS = 10000

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
function g32Grids(program: GCodeProgram): ProbeGrid[] {
  const grids: ProbeGrid[] = []
  let pointCount = 0
  let scale: number | null = null
  let machineStart: ProbePoint | null = null
  for (
    let index = 0;
    index < Math.min(program.lines.length, MAX_PROGRAM_LINES);
    index++
  ) {
    const block = readNcBlock(program.lines[index])
    if (block.problem) {
      machineStart = null
      continue
    }
    if (block.message !== null || !block.words.length) continue
    const positionedStart = machineStart
    machineStart = null
    if (
      block.words.some(
        ({ letter, value }) => letter === "M" && (value === 2 || value === 30)
      )
    )
      break
    const gCodes = block.words.filter(({ letter }) => letter === "G")
    for (const code of gCodes) {
      if (code.value === 20) scale = 25.4
      if (code.value === 21) scale = 1
    }
    // Only a complete, immediately preceding G53 XY move establishes a known
    // physical start. Do not infer positions through macros, pauses or work moves.
    if (
      gCodes.length === 2 &&
      gCodes[0].value === 53 &&
      gCodes[1].value === 0 &&
      block.words.every(({ letter }) =>
        ["N", "G", "X", "Y", "Z", "F"].includes(letter)
      )
    ) {
      const xs = block.words.filter(({ letter }) => letter === "X")
      const ys = block.words.filter(({ letter }) => letter === "Y")
      const zs = block.words.filter(({ letter }) => letter === "Z")
      if (
        scale !== null &&
        xs.length === 1 &&
        ys.length === 1 &&
        zs.length <= 1
      ) {
        const target: ProbePoint = [xs[0].value * scale, ys[0].value * scale]
        if (isAnchorXY(target)) machineStart = target
      }
      continue
    }
    // The firmware's own auto-leveling starts at its X Y in work coordinates, known on the
    // bed only where a G53 travel has just put the probe there.
    const mCodes = block.words.filter(({ letter }) => letter === "M")
    const automation =
      !gCodes.length &&
      mCodes.length === 1 &&
      mCodes[0].value === FIRMWARE_ROUTINE
    if (automation && !positionedStart) continue
    if (
      !automation &&
      (gCodes.length !== 1 || gCodes[0].value !== GRID || mCodes.length)
    )
      continue
    const values = probeFields(
      block.words,
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
    const [width, depth, columns, rows] = ["A", "B", "I", "J"].map((letter) =>
      values.get(letter)!
    )
    // M495's X Y is where the travel already is; G32's is an offset from there.
    const x = (positionedStart?.[0] ?? 0) + (automation ? 0 : values.get("X")!)
    const y = (positionedStart?.[1] ?? 0) + (automation ? 0 : values.get("Y")!)
    if (
      ![x, y, width, depth].every(
        (value) => Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT
      ) ||
      !width ||
      !depth ||
      !Number.isInteger(columns) ||
      !Number.isInteger(rows) ||
      columns < 2 ||
      rows < 2 ||
      columns * rows > MAX_POINTS - pointCount
    )
      continue
    const points = gridSamples({ start: [x, y], width, depth, columns, rows })
    grids.push({
      sourceLine: index + 1,
      start: [x, y],
      width,
      depth,
      columns,
      rows,
      pointCount: points.length,
      points,
      clearanceMm: values.get("H") ?? null,
      coordinateMode: positionedStart ? "machine" : "relative-to-probe-start",
    })
    pointCount += points.length
  }
  return grids
}

/**
 * Rectangular auto-leveling with G32 R1: the firmware measures the grid and applies Z
 * compensation. The job starts from the probe's position, or travels to a stored anchor first.
 */
export const G32_GRID: GridProbing = {
  parameters: GRID_PARAMETERS,
  samples: gridSamples,
  program(size, start, reviewAfterProbe) {
    const word: GridWord = (field) => formatMillimetres(size[field])
    // In work coordinates the firmware's own auto-leveling can run it, reporting as it goes.
    const work = start.kind === "machine" ? start.work : null
    let lines: string[]
    if (start.kind === "probe-position")
      lines = [
        ...INTRODUCTION,
        POSITION_PROBE,
        ...PRECAUTIONS,
        ...PROBE_SETUP,
        GRID_FROM_PROBE,
        probeBlock(word, start),
      ]
    else if (work)
      lines = [
        ...FIRMWARE_INTRODUCTION,
        ...PRECAUTIONS,
        ...FIRMWARE_PROBE_SETUP,
        ...anchorTravel(start),
        firmwareBlock(size, work),
      ]
    else
      lines = [
        ...INTRODUCTION,
        ...PRECAUTIONS,
        ...PROBE_SETUP,
        ...anchorTravel(start),
        probeBlock(word, start),
      ]
    const probeLine = lines.length
    if (reviewAfterProbe) lines.push(...REVIEW_PAUSE)
    const reviewPauseLine = reviewAfterProbe ? lines.length : null
    lines.push(...CONCLUSION)
    return { nc: `${lines.join("\n")}\n`, probeLine, reviewPauseLine }
  },
  grids: g32Grids,
}
