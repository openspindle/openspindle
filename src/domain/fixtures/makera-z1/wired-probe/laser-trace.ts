import { formatMillimetres } from "../../../geometry/millimetres"
import type { AutoScanSpecs } from "../../../auto-scan/params"
import type { OutlineTrace } from "../../../probing/probe"
import { CLEARANCE_Z, MACHINE_Z } from "./travel"

/**
 * The defaults are those of the firmware's own margin scan on the Z1: its configured clearance Z
 * (`coordinate.clearance_z`) and trace speed (`atc.margin_rate_mm_m`). The trace stays within
 * the Z the machine moves in; the feeds are application limits. Neither is a clearance check.
 */
const TRACE_PARAMETERS: AutoScanSpecs = {
  travelZ: {
    label: "Machine Z",
    axis: "Z",
    unit: "mm",
    default: CLEARANCE_Z,
    min: MACHINE_Z.min,
    max: MACHINE_Z.max,
    step: 1,
    description: `Absolute machine Z the probe traces at, clear of the stock and fixtures. Makera configures the Z1's clearance at ${CLEARANCE_Z}.`,
  },
  feed: {
    label: "Trace feed",
    unit: "mm/min",
    default: 1000,
    min: 100,
    max: 3000,
    step: 100,
    description: "How fast the probe's laser follows the outline.",
  },
}

const INTRODUCTION = [
  "; Makera wired Probe 2.0 - auto-scan",
  "; Traces the edges of the plate's work area with the probe's laser.",
  "; REQUIRE: homed machine, installed probe; work X/Y set to the plate's work origin.",
]
const PAUSE = [
  "; Check the outline against the stock and fixtures, then Resume or Stop.",
  "M0",
]

/**
 * The firmware's own margin scan (ATCHandler::fill_margin_scripts) as queued moves: the probe's
 * laser on, machine clearance Z, then the rectangle in work coordinates from its lower-left
 * corner. M494.0 is not queued with the moves, so the laser is not switched off again here: the
 * firmware does that itself after five minutes or at the next tool change.
 */
export const LASER_TRACE: OutlineTrace = {
  parameters: TRACE_PARAMETERS,
  program({
    params: { travelZ, feed, pauseAfterScan },
    outline: { min, max },
  }) {
    const [x0, y0, x1, y1] = [min[0], min[1], max[0], max[1]].map(
      formatMillimetres
    )
    const lines = [
      ...INTRODUCTION,
      `; Outline: X${x0} to X${x1}, Y${y0} to Y${y1} in work coordinates.`,
      "M5",
      "G21 G90",
      "M6 T0",
      "M494.0",
      `G53 G0 Z${formatMillimetres(travelZ)}`,
      `G0 X${x0} Y${y0}`,
      `G1 X${x0} Y${y1} F${formatMillimetres(feed)}`,
      `G1 X${x1} Y${y1}`,
      `G1 X${x1} Y${y0}`,
      `G1 X${x0} Y${y0}`,
      ...(pauseAfterScan ? PAUSE : []),
      "M2",
    ]
    return { nc: `${lines.join("\n")}\n`, probeLine: null, reviewLine: null }
  },
}
