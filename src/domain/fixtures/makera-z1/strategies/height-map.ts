import { formatMillimetres } from "../../../geometry/millimetres"
import type { XY } from "../../../geometry/frame"
import type { AnchorStart } from "../../../probing/placement"
import { placementContext } from "../../../probing/placement"
import type { GridPlan } from "../../../probing/probe"
import type { BoundProbe, ProbingMethod } from "../../../probing/strategy"
import { plateGridParams } from "../../../probing/tasks/grid/fit"
import type { GridParams, GridSpecs } from "../../../probing/tasks/grid/params"
import { planGrid } from "../../../probing/tasks/grid/plan"
import { firmwareMillimetres } from "../probing-nc"
import { CLEARANCE_Z } from "../wired-probe/travel"

/**
 * The wired probe grid bounds. They are application
 * limits, not a clearance check; the included firmware configuration allows at most 15 × 15
 * points.
 */
const GRID_PARAMETERS: GridSpecs = {
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

/** What the program is, by the probe it probes with. */
const title = ({ tool }: BoundProbe) =>
  `; ${tool.name} - rectangular auto-leveling`

const INTRODUCTION = [
  "; The firmware measures the grid and applies Z compensation.",
  "; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.",
]
const FIRMWARE_INTRODUCTION = [
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
/** M494.0 switches the probe's laser on; M495 switches it itself. */
const LASER_ON = "M494.0"
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
  const mm = firmwareMillimetres
  return `M495 X${mm(x)} Y${mm(y)} A${mm(size[0])} B${mm(size[1])} I${points[0]} J${points[1]} H${mm(clearance)}`
}

/**
 * Rectangular auto-leveling with the Z1 firmware's G32 R1, with a Z touch probe in T0: the
 * firmware measures the grid and applies Z compensation. The job starts from the probe's
 * position, or travels to a stored anchor first; from there, on a plate whose program sets work
 * X and Y (`workOriginOnMachine`), the firmware's own auto-leveling (M495) runs it in work
 * coordinates, reporting as it goes.
 */
export const HEIGHT_MAP: ProbingMethod<"grid", GridParams, GridSpecs> = {
  id: "makera-z1/height-map",
  task: "grid",
  strategies: ["height-map"],
  description:
    "The machine probes the grid itself, reports the height map and compensates later cuts for it.",
  accepts: ({ touch }) => touch === "z",
  parameters: () => GRID_PARAMETERS,
  defaults: plateGridParams,
  generate: ({ params, plate, probe, machine }) => {
    const plan = planGrid(params, placementContext(plate), GRID_PARAMETERS)
    if (!plan.ok) return plan
    const { start } = plan
    const select = machine.nc.select(probe)
    const work = start.kind === "anchor" ? start.work : null
    let lines: string[]
    if (start.kind === "probe-position")
      lines = [
        title(probe),
        ...INTRODUCTION,
        POSITION_PROBE,
        ...PRECAUTIONS,
        ...select,
        LASER_ON,
        GRID_FROM_PROBE,
        probeBlock(plan.params),
      ]
    else if (work)
      lines = [
        title(probe),
        ...FIRMWARE_INTRODUCTION,
        ...PRECAUTIONS,
        ...select,
        ...anchorTravel(start),
        firmwareBlock(plan.params, work),
      ]
    else
      lines = [
        title(probe),
        ...INTRODUCTION,
        ...PRECAUTIONS,
        ...select,
        LASER_ON,
        ...anchorTravel(start),
        probeBlock(plan.params),
      ]
    const review = plan.params.reviewAfterProbe
    if (review) lines.push(...REVIEW_PAUSE)
    const reviewLine = review ? lines.length : null
    lines.push(...CONCLUSION)
    return { ok: true, program: { nc: `${lines.join("\n")}\n`, reviewLine } }
  },
}
