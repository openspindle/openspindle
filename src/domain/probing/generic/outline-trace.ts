import type { OutlineParams, OutlineSpecs } from "../tasks/outline/params"
import { planOutline } from "../tasks/outline/plan"
import { roundOutward } from "../../compile/cutting-bounds"
import { issueOf } from "../../diagnostics"
import { formatMillimetres } from "../../geometry/millimetres"
import { boxRect } from "../../geometry/rect"
import { defaultsOf } from "../parameters"
import type { ProbingStrategy } from "../strategy"
import { hasSpecs, specsOf } from "./specs"

const INTRODUCTION = [
  "; Outline trace",
  "; Traces the edges of the plate's work area with the probe's pointer.",
  "; REQUIRE: homed machine, installed probe; work X/Y set to the plate's work origin.",
]
const PAUSE = [
  "; Check the outline against the stock and fixtures, then Resume or Stop.",
  "M0",
]

/**
 * A probe's pointer the machine cannot switch on traces nothing. Such a machine does not run the
 * trace (`runsOn`), so this only guards its NC.
 */
const NO_POINTER = issueOf<"no-pointer">("error")(
  "no-pointer",
  "This machine cannot switch on a probe's pointer to trace with."
)

/**
 * OpenSpindle's own trace of the plate's toolpath bounds, rounded outwards, with the probe's
 * pointer: the pointer on, up to a machine Z clear of the stock, then the rectangle in work
 * coordinates from its lower-left corner at the trace feed, and a pause to check it if the
 * operation asks for one. Nothing touches, so the job reviews no measurement.
 */
export const OUTLINE_TRACE: ProbingStrategy<
  "outline",
  OutlineParams,
  OutlineSpecs
> = {
  id: "outline-trace",
  task: "outline",
  label: "Outline trace",
  description: "Trace the edges of the plate's work area before cutting.",
  runsOn: (machine) =>
    machine.nc.pointer !== null && hasSpecs(machine, "outline-trace"),
  accepts: (probe) => probe.pointer,
  parameters: (machine) => specsOf(machine, "outline-trace"),
  defaults: (_plate, parameters) => ({
    ...defaultsOf(parameters),
    pauseAfterScan: true,
  }),
  // The outline is the plate's other operations' toolpath bounds, so it never goes stale.
  generate: ({ params, probe, machine, machining }) => {
    const { pointer } = machine.nc
    if (!pointer) return { ok: false, issues: [NO_POINTER] }
    const plan = planOutline(
      params,
      machining.toolpath(),
      specsOf(machine, "outline-trace")
    )
    if (!plan.ok) return plan
    const { travelZ, feed, pauseAfterScan } = plan.params
    const { min, max } = boxRect<"work">(roundOutward(plan.outline))
    const [x0, y0, x1, y1] = [min[0], min[1], max[0], max[1]].map(
      formatMillimetres
    )
    const lines = [
      ...INTRODUCTION,
      `; Outline: X${x0} to X${x1}, Y${y0} to Y${y1} in work coordinates.`,
      ...machine.nc.select(probe),
      ...pointer.on,
      `G53 G0 Z${formatMillimetres(travelZ)}`,
      `G0 X${x0} Y${y0}`,
      `G1 X${x0} Y${y1} F${formatMillimetres(feed)}`,
      `G1 X${x1} Y${y1}`,
      `G1 X${x1} Y${y0}`,
      `G1 X${x0} Y${y0}`,
      ...(pauseAfterScan ? PAUSE : []),
      "M2",
    ]
    return {
      ok: true,
      program: { nc: `${lines.join("\n")}\n`, reviewLine: null },
    }
  },
}
