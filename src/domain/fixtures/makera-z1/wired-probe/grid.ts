import { formatMillimetres } from "../../../geometry/millimetres"
import type { AutoLevelSpecs } from "../../../auto-level/params"
import { plus } from "../../../geometry/frame"
import type { Frame, Vec2, XY } from "../../../geometry/frame"
import type { AnchorStart } from "../../../probing/placement"
import { COORDINATE_LIMIT } from "../../../primitives"
import type { GridPlan, GridProbing } from "../../../probing/probe"
import { PROBE_START } from "../../../probing/preview"
import type { ProbeAt, ProbeGrid } from "../../../probing/preview"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { FIRMWARE_ROUTINE, GRID, probeFields } from "./blocks"
import { isMachineTravel, scanBlocks, travelTarget } from "./scan"
import { CLEARANCE_Z } from "./travel"

/**
 * The grid bounds (those of the retired makera-wired-probe plugin). They are application
 * limits, not a clearance check; the included firmware configuration allows at most 15 × 15
 * points.
 */
const GRID_PARAMETERS: AutoLevelSpecs = {
  size: [
    {
      label: "Width",
      axis: "X",
      unit: "mm",
      default: 50,
      min: 1,
      max: 200,
      step: 0.1,
    },
    {
      label: "Depth",
      axis: "Y",
      unit: "mm",
      default: 50,
      min: 1,
      max: 200,
      step: 0.1,
    },
  ],
  points: [
    {
      label: "X probe points",
      default: 5,
      min: 2,
      max: 15,
      step: 1,
      integer: true,
    },
    {
      label: "Y probe points",
      default: 5,
      min: 2,
      max: 15,
      step: 1,
      integer: true,
    },
  ],
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
function anchorTravel({ anchor, source, machine }: AnchorStart): string[] {
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
    `G53 G0 X${formatMillimetres(machine[0])} Y${formatMillimetres(machine[1])}`,
  ]
}

/** R1: the grid from where the probe is, the probe position or the G53 target (X0 Y0). */
function probeBlock({ size, points, clearance }: GridPlan["params"]): string {
  const mm = formatMillimetres
  return `G32 R1 X0 Y0 A${mm(size[0])} B${mm(size[1])} I${points[0]} J${points[1]} H${mm(clearance)}`
}

/**
 * The firmware's own auto-leveling (ATCHandler::fill_autolevel_scripts): over X Y in work
 * coordinates, where the G53 travel already is, then `G32 R1 X0 Y0` with the same size, points
 * and height. The firmware prints its values with three decimals, as these are.
 */
function firmwareBlock(
  { size, points, clearance }: GridPlan["params"],
  [x, y]: XY<"work">
): string {
  const mm = (value: number) => String(Number(value.toFixed(3)) + 0)
  return `M495 X${mm(x)} Y${mm(y)} A${mm(size[0])} B${mm(size[1])} I${points[0]} J${points[1]} H${mm(clearance)}`
}

/**
 * Samples in the firmware's visiting order. Makera Z1 CartGridStrategy.cpp:674–698 includes both
 * grid edges and visits alternate rows in reverse order.
 */
function gridSamples<TFrame extends Frame>(
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
function g32Grids(program: GCodeProgram): ProbeGrid<"probe" | "machine">[] {
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

/**
 * Rectangular auto-leveling with G32 R1: the firmware measures the grid and applies Z
 * compensation. The job starts from the probe's position, or travels to a stored anchor first.
 */
export const G32_GRID: GridProbing = {
  parameters: GRID_PARAMETERS,
  samples: gridSamples,
  program({ params, start }) {
    // In work coordinates the firmware's own auto-leveling can run it, reporting as it goes.
    const work = start.kind === "anchor" ? start.work : null
    let lines: string[]
    if (start.kind === "probe-position")
      lines = [
        ...INTRODUCTION,
        POSITION_PROBE,
        ...PRECAUTIONS,
        ...PROBE_SETUP,
        GRID_FROM_PROBE,
        probeBlock(params),
      ]
    else if (work)
      lines = [
        ...FIRMWARE_INTRODUCTION,
        ...PRECAUTIONS,
        ...FIRMWARE_PROBE_SETUP,
        ...anchorTravel(start),
        firmwareBlock(params, work),
      ]
    else
      lines = [
        ...INTRODUCTION,
        ...PRECAUTIONS,
        ...PROBE_SETUP,
        ...anchorTravel(start),
        probeBlock(params),
      ]
    const probeLine = lines.length
    if (params.reviewAfterProbe) lines.push(...REVIEW_PAUSE)
    const reviewLine = params.reviewAfterProbe ? lines.length : null
    lines.push(...CONCLUSION)
    return { nc: `${lines.join("\n")}\n`, probeLine, reviewLine }
  },
  grids: g32Grids,
}
