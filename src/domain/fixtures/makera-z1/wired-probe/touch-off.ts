import { formatMillimetres } from "../../../geometry/millimetres"
import type {
  AutoZHeightField,
  AutoZHeightSpecs,
  AutoZHeightParams,
} from "../../../auto-z-height/params"
import type { XY } from "../../../geometry/frame"
import type { TouchOff } from "../../../probing/probe"
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
import { anchorTravel } from "./travel"

/**
 * Application limits, not a clearance check. The default travel is the one the firmware's own
 * Z probe uses on the Z1 (`coordinate.toolrack_z`): a probe change ends at the firmware's
 * clearance Z near the top of travel, and the search has to reach the stock from there.
 */
const TOUCH_PARAMETERS: AutoZHeightSpecs = {
  probeTravel: {
    label: "Probe travel",
    axis: "Z",
    unit: "mm",
    default: 108,
    min: 1,
    max: 150,
    step: 1,
    description:
      "How far the probe searches down before the machine alarms. After a probe change it starts near the top of Z travel. The machine's own Z probe, run from a stored anchor with the work origin kept relative to one, searches to its tool rack Z instead.",
  },
  clearance: {
    label: "Clearance height",
    axis: "Z",
    unit: "mm",
    default: 5,
    min: 0.5,
    max: 50,
    step: 0.5,
    description: "Lift above the probed surface once work Z is set.",
  },
}

/**
 * The supplied Z1 configuration's probe speeds (mm/min) and back-off (mm) between the fast and
 * the slow touch: `atc.probe.fast_rate_mm_m`, `slow_rate_mm_m` and `retract_mm`, as the
 * firmware's own Z probe uses them.
 */
const TOUCH_OFF_MOTION = {
  fastFeed: 500,
  slowFeed: 100,
  backOff: 1,
} as const

type Touch = Pick<AutoZHeightParams, AutoZHeightField>

const INTRODUCTION = [
  "; Makera wired Probe 2.0 - auto Z-height",
  "; Touches the stock top and sets work Z0 there with G10 L20.",
  "; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.",
]
const FIRMWARE_INTRODUCTION = [
  "; Makera wired Probe 2.0 - auto Z-height",
  "; The firmware's own Z probe (M495, as Makera Studio runs it) touches the stock top,",
  "; reports the touch and sets work Z0 there.",
  "; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.",
]
const POSITION_PROBE = [
  "; Position the probe above the point to measure before Run;",
  "; a probe change returns to the firmware's clearance Z above it.",
]
const PROBE_SETUP = ["M5", "G21 G90", "M6 T0", "M494.1"]
/** M495 switches the probe's laser itself. */
const FIRMWARE_PROBE_SETUP = ["M5", "G21 G90", "M6 T0"]

function precautions(travel: string) {
  return [
    `; The probe searches at most ${travel} mm down; no contact alarms the machine.`,
    "; Replaces work Z of the active coordinate system; the firmware saves G54.",
  ]
}
const FIRMWARE_PRECAUTIONS = [
  "; The probe searches down as far as the firmware's tool rack Z; no contact alarms the machine.",
  "; Replaces work Z of the active coordinate system; the firmware saves G54.",
]

/**
 * The firmware's own Z probe (ATCHandler::fill_zprobe_scripts) up to its first touch, the fast
 * one; `slowTouch` follows it. The firmware reads G38.2 distances as relative in any mode; G91
 * says so for every reader.
 */
function fastTouch({ probeTravel }: Pick<Touch, "probeTravel">) {
  return [
    "; Touch fast, back off, touch again slowly (relative G38.2 distances).",
    "G91",
    `G38.2 Z-${formatMillimetres(probeTravel)} F${TOUCH_OFF_MOTION.fastFeed}`,
  ]
}

/**
 * The rest of the firmware's own Z probe after the fast touch: a back-off, a slow touch, then
 * G10 L20 P0 sets work Z0 at the contact.
 */
function slowTouch({ clearance }: Pick<Touch, "clearance">) {
  const { slowFeed, backOff } = TOUCH_OFF_MOTION
  return [
    `G0 Z${backOff}`,
    `G38.2 Z-${backOff + 1} F${slowFeed}`,
    "G90",
    "; The probed surface is the stock top: work Z0.",
    "G10 L20 P0 Z0",
    `G0 Z${formatMillimetres(clearance)}`,
    "M494.2",
  ]
}

/**
 * The firmware's own Z probe (ATCHandler::fill_zprobe_scripts), run by M495 with a zero O/F
 * offset from X Y: over X Y in work coordinates, where the G53 travel already is, the same fast
 * and slow touches, then work Z0 at the contact and 1 mm up, left in G91. The machine reports
 * every step.
 */
function firmwareTouch([x, y]: XY<"work">) {
  const mm = (value: number) => String(Number(value.toFixed(3)) + 0)
  return `M495 X${mm(x)} Y${mm(y)} O0 F0`
}

/** Back to absolute distances after the firmware's Z probe, and up to the clearance. */
function firmwareLift({ clearance }: Pick<Touch, "clearance">) {
  return ["G90", `G0 Z${formatMillimetres(clearance)}`]
}

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
function touchPoints(
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

/** The firmware's own Z probe with the wired probe, then work Z set at the contact. */
export const TOUCH_OFF: TouchOff = {
  parameters: TOUCH_PARAMETERS,
  program({ params, start }) {
    const travel = formatMillimetres(params.probeTravel)
    // In work coordinates the firmware's own Z probe can run it, reporting as it goes.
    const work = start.kind === "anchor" ? start.work : null
    let lines: string[]
    if (start.kind === "probe-position")
      lines = [
        ...INTRODUCTION,
        ...POSITION_PROBE,
        ...precautions(travel),
        ...PROBE_SETUP,
        ...fastTouch(params),
      ]
    else if (work)
      lines = [
        ...FIRMWARE_INTRODUCTION,
        ...FIRMWARE_PRECAUTIONS,
        ...FIRMWARE_PROBE_SETUP,
        ...anchorTravel(start),
        firmwareTouch(work),
      ]
    else
      lines = [
        ...INTRODUCTION,
        ...precautions(travel),
        ...PROBE_SETUP,
        ...anchorTravel(start),
        ...fastTouch(params),
      ]
    lines.push(...(work ? firmwareLift(params) : slowTouch(params)), "M2")
    return { nc: `${lines.join("\n")}\n`, reviewLine: null }
  },
  touches: touchPoints,
}
