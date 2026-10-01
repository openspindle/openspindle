import { issueOf } from "../../../diagnostics"
import { COORDINATE_LIMIT } from "../../../primitives"
import type { XY } from "../../../geometry/frame"
import { formatMillimetres } from "../../../geometry/millimetres"
import { workOriginOnMachine } from "../../../plate/work-origin"
import { placementAnchors, placementContext } from "../../../probing/placement"
import type { BoundProbe, ProbingStrategy } from "../../../probing/strategy"
import { plateTouchOffParams } from "../../../probing/tasks/touch-off/fit"
import type {
  TouchOffParams,
  TouchOffSpecs,
} from "../../../probing/tasks/touch-off/params"
import { planTouchOff } from "../../../probing/tasks/touch-off/plan"
import { TOUCH_PARAMETERS, firmwareMillimetres } from "../probing-nc"
import { anchorTravel } from "../wired-probe/travel"

/**
 * Surface touch's ranges on the Z1 (`TOUCH_PARAMETERS`), whose probe travel says that the
 * firmware's Z probe searches down to its tool rack Z instead.
 */
const Z_PROBE_PARAMETERS: TouchOffSpecs = {
  ...TOUCH_PARAMETERS,
  probeTravel: {
    ...TOUCH_PARAMETERS.probeTravel,
    description:
      "How far the probe searches down before the machine alarms. After a probe change it starts near the top of Z travel. The machine's own Z probe, run from a stored anchor with the work origin kept relative to one, searches to its tool rack Z instead.",
  },
}

/**
 * The Z probe's ranges as generating holds the parameters to them: only what M495 reads. The
 * probe travel, which it does not read, passes as stored.
 */
const READ_PARAMETERS: TouchOffSpecs = {
  ...Z_PROBE_PARAMETERS,
  probeTravel: {
    ...Z_PROBE_PARAMETERS.probeTravel,
    min: 0,
    max: COORDINATE_LIMIT,
  },
}

/** What the program is, by the probe it touches with. */
const title = ({ tool }: BoundProbe) => `; ${tool.name} - auto Z-height`

const INTRODUCTION = [
  "; The firmware's own Z probe (M495, as Makera Studio runs it) touches the stock top,",
  "; reports the touch and sets work Z0 there.",
  "; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.",
]
const PRECAUTIONS = [
  "; The probe searches down as far as the firmware's tool rack Z; no contact alarms the machine.",
  "; Replaces work Z of the active coordinate system; the firmware saves G54.",
]

/** The firmware's Z probe goes to its X Y in work coordinates, which only an anchored start has. */
const NOT_ANCHORED = issueOf<"work-origin-not-anchored">("error")(
  "work-origin-not-anchored",
  "The firmware's Z probe touches only at a stored anchor, on a plate whose work origin is kept relative to an anchor. Touch at an anchor and keep the work origin on one, or use Surface touch."
)

/**
 * The firmware's own Z probe (ATCHandler::fill_zprobe_scripts), run by M495 with a zero O/F
 * offset from X Y: over X Y in work coordinates, where the G53 travel already is, the same fast
 * and slow touches, then work Z0 at the contact and 1 mm up, left in G91. The machine reports
 * every step.
 */
function firmwareTouch([x, y]: XY<"work">) {
  const mm = firmwareMillimetres
  return `M495 X${mm(x)} Y${mm(y)} O0 F0`
}

/** Back to absolute distances after the firmware's Z probe, and up to the clearance. */
function firmwareLift({ clearance }: Pick<TouchOffParams, "clearance">) {
  return ["G90", `G0 Z${formatMillimetres(clearance)}`]
}

/**
 * The Z1 firmware's own Z probe with a Z touch probe in T0, which reports the touch as it goes:
 * from a stored anchor on a plate that keeps its work origin relative to an anchor, where the
 * touch point has work coordinates. M495 switches the probe's laser itself.
 */
export const Z_PROBE: ProbingStrategy<
  "touch-off",
  TouchOffParams,
  TouchOffSpecs
> = {
  id: "makera-z1/z-probe",
  task: "touch-off",
  label: "Z probe (Z1 firmware)",
  description:
    "Touch the stock top with the machine's own Z probe at a stored anchor and set work Z there; the machine reports the touch.",
  accepts: ({ touch }) => touch === "z",
  // Its settings choose the anchor later; the plate decides whether an anchored start can have
  // work coordinates at all.
  blocked: (plate) => {
    if (!placementAnchors(plate.setup).length)
      return "The firmware's Z probe touches only at a stored anchor: select an anchor snapshot for this plate's device."
    if (!workOriginOnMachine(plate.setup))
      return "The firmware's Z probe touches only on a plate whose work origin is kept relative to an anchor."
    return null
  },
  parameters: () => Z_PROBE_PARAMETERS,
  // M495 searches down as far as the firmware's tool rack Z, whatever the probe travel.
  reads: () => ({ probeTravel: false, clearance: true }),
  defaults: plateTouchOffParams,
  generate: ({ params, plate, probe, machine }) => {
    const plan = planTouchOff(params, placementContext(plate), READ_PARAMETERS)
    if (!plan.ok) return plan
    const { start } = plan
    if (start.kind !== "anchor" || !start.work)
      return { ok: false, issues: [NOT_ANCHORED] }
    const lines = [
      title(probe),
      ...INTRODUCTION,
      ...PRECAUTIONS,
      ...machine.nc.select(probe),
      ...anchorTravel(start),
      firmwareTouch(start.work),
      ...firmwareLift(plan.params),
      "M2",
    ]
    return {
      ok: true,
      program: { nc: `${lines.join("\n")}\n`, reviewLine: null },
    }
  },
}
