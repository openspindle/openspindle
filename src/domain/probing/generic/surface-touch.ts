import { plateTouchOffParams } from "../tasks/touch-off/fit"
import type {
  TouchOffField,
  TouchOffParams,
  TouchOffSpecs,
} from "../tasks/touch-off/params"
import { planTouchOff } from "../tasks/touch-off/plan"
import { formatMillimetres } from "../../geometry/millimetres"
import { placementContext } from "../placement"
import type { ProbingMethod, ProbingNc } from "../strategy"
import { hasSpecs, specsOf } from "./specs"

const INTRODUCTION = [
  "; Z surface",
  "; Touches the stock top and sets work Z0 there with G10 L20.",
  "; REQUIRE: homed machine, installed/calibrated probe, tested probe signal.",
]
const POSITION_PROBE = [
  "; Position the probe above the point to touch before Run;",
  "; it touches straight down from where the probe change leaves it.",
]

function precautions(travel: string) {
  return [
    `; The probe searches at most ${travel} mm down; no contact alarms the machine.`,
    "; Replaces work Z of the active coordinate system.",
  ]
}

/**
 * The touch-off itself, straight down from where the probe is: a fast touch at most
 * `probeTravel` down, the machine's back-off, a slow touch at most 1 mm past where the fast one
 * stopped, then work Z0 at the contact (G10 L20 P0 sets it in the active coordinate system) and
 * up to the clearance. Some firmwares read G38.2 distances as relative in any mode; G91 says
 * so for every reader.
 */
function touchOff(
  { probeTravel, clearance }: Pick<TouchOffParams, TouchOffField>,
  { fastFeed, slowFeed, backOff }: ProbingNc["touch"]
) {
  const mm = formatMillimetres
  return [
    "; Touch fast, back off, touch again slowly (relative G38.2 distances).",
    "G91",
    `G38.2 Z-${mm(probeTravel)} F${mm(fastFeed)}`,
    `G0 Z${mm(backOff)}`,
    `G38.2 Z-${mm(backOff + 1)} F${mm(slowFeed)}`,
    "G90",
    "; The probed surface is the stock top: work Z0.",
    "G10 L20 P0 Z0",
    `G0 Z${mm(clearance)}`,
  ]
}

/**
 * OpenSpindle's own touch-off: from the probe position, or from an anchored start the machine
 * travels to, a fast G38.2 touch down, a back-off and a slow touch, then work Z0 at the contact
 * (G10 L20) and up to the clearance. It touches with G38.2 wherever it starts, so a machine's own
 * Z probe cycle runs the touch-off instead where it can (`methodFor`).
 */
export const GENERIC_TOUCH: ProbingMethod<
  "touch-off",
  TouchOffParams,
  TouchOffSpecs
> = {
  id: "touch",
  task: "touch-off",
  strategies: ["touch-off"],
  description:
    "Touches down with the probe from where it is or from a stored anchor, fast then slowly, and sets work Z at the contact.",
  runsOn: (machine) => hasSpecs(machine, "touch"),
  // Any touch probe touches down along Z; a pointer is not used.
  accepts: () => true,
  parameters: (machine) => specsOf(machine, "touch"),
  defaults: plateTouchOffParams,
  generate: ({ params, plate, probe, machine }) => {
    const plan = planTouchOff(
      params,
      placementContext(plate),
      specsOf(machine, "touch")
    )
    if (!plan.ok) return plan
    const { start } = plan
    const { nc } = machine
    const lines = [
      ...INTRODUCTION,
      ...(start.kind === "probe-position" ? POSITION_PROBE : []),
      ...precautions(formatMillimetres(plan.params.probeTravel)),
      ...nc.select(probe),
      ...nc.indicator.touching,
      ...(start.kind === "anchor" ? nc.travel(start) : []),
      ...touchOff(plan.params, nc.touch),
      ...nc.indicator.touched,
      "M2",
    ]
    return {
      ok: true,
      program: { nc: `${lines.join("\n")}\n`, reviewLine: null },
    }
  },
}
