import type { ProbeTool } from "../../probing/probe"
import { PROBE_TOOL } from "../../tools/tool-table"
import { G32_GRID } from "./wired-probe/grid"
import { LASER_TRACE } from "./wired-probe/laser-trace"
import { TOUCH_OFF } from "./wired-probe/touch-off"

/**
 * Makera's wired Probe 2.0 on the Z1: G32 grids that the firmware compensates with, the
 * firmware's own Z touch-off, and the probe's laser to trace an outline.
 */
export const WIRED_PROBE: ProbeTool = {
  slot: PROBE_TOOL,
  name: "probe",
  capabilities: {
    grid: G32_GRID,
    "touch-off": TOUCH_OFF,
    outline: LASER_TRACE,
  },
}
