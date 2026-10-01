import { toMicrometre } from "../../primitives"
import type { OutlineSpecs } from "../../probing/tasks/outline/params"
import type { TouchOffSpecs } from "../../probing/tasks/touch-off/params"
import type { GenericSpecs } from "../../probing/generic/specs"
import type { ProbingNc } from "../../probing/strategy"
import { CLEARANCE_Z, MACHINE_Z, anchorTravel } from "./wired-probe/travel"

/**
 * Surface touch's ranges on the Z1: application limits, not a clearance check. The default travel
 * is the one the firmware's own Z probe uses on the Z1 (`coordinate.toolrack_z`): a probe change
 * ends at the firmware's clearance Z near the top of travel, as anchored travel does, and the
 * search has to reach the stock from there.
 */
export const TOUCH_PARAMETERS: TouchOffSpecs = {
  probeTravel: {
    label: "Probe travel",
    axis: "Z",
    unit: "mm",
    default: 108,
    min: 1,
    max: 150,
    step: 1,
    description:
      "How far the probe searches down before the machine alarms. After a probe change, or the travel to an anchor, it starts near the top of Z travel.",
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
 * A length as the firmware prints its own probing's values (ATCHandler's scripts): three
 * decimals at most.
 */
export const firmwareMillimetres = (value: number) =>
  String(toMicrometre(value))

/**
 * The supplied Z1 configuration's probe speeds (mm/min) and back-off (mm) between the fast and
 * the slow touch: `atc.probe.fast_rate_mm_m`, `slow_rate_mm_m` and `retract_mm`, as the
 * firmware's own Z probe uses them.
 */
export const TOUCH_OFF_MOTION = {
  fastFeed: 500,
  slowFeed: 100,
  backOff: 1,
} as const

/**
 * The defaults are those of the firmware's own margin scan on the Z1: its configured clearance Z
 * (`coordinate.clearance_z`) and trace speed (`atc.margin_rate_mm_m`). The trace stays within
 * the Z the machine moves in; the feeds are application limits. Neither is a clearance check.
 */
export const TRACE_PARAMETERS: OutlineSpecs = {
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

/**
 * The Z1's probing NC that generic strategies are made of, as its firmware (1.1.2) runs it: the
 * probe change and the probe's laser are ATCHandler.cpp's, the touch speeds and the clearance
 * `src/configZ1.default`'s, as Makera sets them on the Z1 and Z1 Pro.
 */
export const Z1_PROBING_NC: ProbingNc = {
  /**
   * M5 stops the spindle, G21 G90 selects millimetres and absolute distances, and M6 changes to
   * the probe by hand: the firmware calibrates it on the tool setter and returns over where the
   * change began (`fill_change_scripts`, `fill_cali_scripts`). A probe already held changes
   * nothing.
   */
  select: (probe) => ["M5", "G21 G90", `M6 T${probe.number}`],
  /**
   * M494.0 switches the probe's laser on. It is not queued with the moves, so nothing switches it
   * off again: the firmware does that itself after five minutes or at the next tool change.
   */
  pointer: { on: ["M494.0"] },
  /** The probe's laser shows a touch-off: M494.1 switches it on until M494.2 switches it off. */
  indicator: { touching: ["M494.1"], touched: ["M494.2"] },
  /** Up to the clearance Makera configures, then over the start in machine coordinates. */
  travel: anchorTravel,
  touch: TOUCH_OFF_MOTION,
}

/** The Z1's ranges and defaults for the generic strategies. */
export const Z1_GENERIC_SPECS: GenericSpecs = {
  "surface-touch": TOUCH_PARAMETERS,
  "outline-trace": TRACE_PARAMETERS,
}
