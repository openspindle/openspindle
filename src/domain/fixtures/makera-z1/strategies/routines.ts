import { issueOf } from "../../../diagnostics"
import { formatMillimetres } from "../../../geometry/millimetres"
import {
  PROBE_3D_AXES_LABELS,
  PROBE_3D_CORNER_LABELS,
  PROBE_3D_ROUTINE_LABELS,
  cornerInward,
  defaultOriginParams,
  findsCorner,
  originFields,
  setsWorkXY,
  setsWorkZ,
} from "../../../probing/tasks/origin/params"
import type {
  OriginSpecs,
  OriginParams,
} from "../../../probing/tasks/origin/params"
import {
  originStartOffset,
  planOrigin,
} from "../../../probing/tasks/origin/plan"
import { fail, ok, toolNumberText } from "../../../primitives"
import type { Result } from "../../../primitives"
import type { ParameterSpec } from "../../../probing/parameters"
import { placementContext } from "../../../probing/placement"
import type { BoundProbe, ProbingStrategy } from "../../../probing/strategy"
import type { Tool } from "../../../tools/tool"
import { ORIGIN_ROUTINE, routineSubcode } from "../3d-probe/blocks"
import { firmwareMillimetres } from "../probing-nc"
import { anchorTravel } from "../wired-probe/travel"

/** How far in one axis the probe moves out; X's and Y's differ only in their axis. */
const distance = (axis: "X" | "Y"): ParameterSpec => ({
  label: `Distance ${axis}`,
  axis,
  unit: "mm",
  default: 10,
  min: 2,
  max: 100,
  step: 1,
  description: `How far in ${axis} the probe moves out from where it starts, then comes down and touches back: past a corner's side, or a boss's, which takes more than half the boss plus the ball's radius. A pocket's centring searches this far each way.`,
})

/**
 * Application limits, not a clearance check. The firmware's own defaults are 20 mm distances and
 * a 2 mm depth.
 */
const ROUTINE_PARAMETERS: OriginSpecs = {
  distance: [distance("X"), distance("Y")],
  depth: {
    label: "Probe depth",
    axis: "Z",
    unit: "mm",
    default: 2,
    min: 0.5,
    max: 50,
    step: 0.5,
    description:
      "How far below the top, which the probe touches first, it touches the sides.",
  },
}

/**
 * The balls the routines take, mm: application limits. Each side the probe touches is set half
 * the ball beyond the ball's centre.
 */
const BALL = { min: 0.5, max: 10 } as const

/** Lengths as the firmware prints its own routines' values. */
const mm = firmwareMillimetres

/**
 * A probe's ball, its diameter, when the routines take it; otherwise why not, as a sentence
 * about the probe that `held` names.
 */
function ballOf({ diameter }: Tool, held: string): Result<number, string> {
  if (diameter === null)
    return fail(
      `${held} has no ball diameter: set it in the tool library, or assign another probe.`
    )
  if (diameter < BALL.min || diameter > BALL.max)
    return fail(
      `${held} has a ${formatMillimetres(diameter)} mm ball, but the 3D probing routines take ${BALL.min} to ${BALL.max} mm: correct it in the tool library, or assign another probe.`
    )
  return ok(diameter)
}

/** A probe whose ball the routines do not take, which resolving refuses first (`refuses`). */
const ballRefused = issueOf<"ball-refused">("error")

/** What the routine touches with which probe, and what it sets. */
function introduction(
  params: OriginParams,
  subcode: number,
  { tool }: BoundProbe
): string[] {
  const { routine, corner, axes } = params
  const [inX, inY] = cornerInward(corner)
  const sideX = inX > 0 ? "left" : "right"
  const sideY = inY > 0 ? "front" : "back"
  const code = `M${ORIGIN_ROUTINE}.${subcode}`
  const what = PROBE_3D_ROUTINE_LABELS[routine].toLowerCase()
  const title = findsCorner(routine)
    ? `${what}, ${PROBE_3D_CORNER_LABELS[corner].toLowerCase()}`
    : `${what}, ${PROBE_3D_AXES_LABELS[axes].replace(" only", "")}`
  const lines = [`; ${tool.name} - 3D probing: ${title}`]
  switch (routine) {
    case "outside-corner":
      lines.push(
        `; The firmware's corner routine (${code}) touches the top, then the ${sideX} and ${sideY} sides,`,
        "; and sets work X0 Y0 at the corner and Z0 on the top."
      )
      break
    case "inside-corner":
      lines.push(
        `; The firmware's corner routine (${code}) touches the top outside the corner, then moves in and`,
        `; touches the ${sideX} and ${sideY} walls: work X0 Y0 at the corner, Z0 on the top.`
      )
      break
    case "pocket-center":
      lines.push(
        `; The firmware's centring routine (${code}) touches the walls either side from where the`,
        "; probe is, inside the pocket, and sets work X0 Y0 midway between them."
      )
      break
    case "boss-center":
      lines.push(
        `; The firmware's centring routine (${code}) touches the boss's top, then its sides either`,
        "; side, and sets work X0 Y0 midway between them and Z0 on the top."
      )
      break
  }
  lines.push(
    "; REQUIRE: homed machine, installed 3D probe with its cable in, tested probe signal."
  )
  return lines
}

/** Where to put the probe before Run, when the program does not travel there itself. */
function positioning(params: OriginParams): string[] {
  const [x, y] = originStartOffset(params).map((value) =>
    formatMillimetres(Math.abs(value))
  )
  const where = {
    "outside-corner": `about X${x} Y${y} in from the corner, over its top,`,
    "inside-corner": `over the top outside the corner, about X${x} Y${y} beyond both walls`,
    "pocket-center": "over the pocket or bore, near its middle,",
    "boss-center": "over the middle of the boss",
  }[params.routine]
  return [
    `; Position the probe ${where} before Run;`,
    "; a probe change returns above it at the firmware's clearance height.",
  ]
}

/** What the program replaces, and what alarms. */
function precautions({ routine, axes }: OriginParams): string[] {
  const [x, y] = setsWorkXY(routine, axes)
  const set = [
    ...(x ? ["X"] : []),
    ...(y ? ["Y"] : []),
    ...(setsWorkZ(routine) ? ["Z"] : []),
  ]
  const named =
    set.length > 1 ? `${set.slice(0, -1).join(", ")} and ${set.at(-1)}` : set[0]
  return [
    "; A search that touches nothing alarms the machine.",
    `; Replaces work ${named} of the active coordinate system; the firmware saves G54.`,
  ]
}

/**
 * The firmware's routine (ATCHandler's M480): D the ball, X and Y the distances, Z the depth,
 * less what the routine does not read (`originFields`): a pocket's centring, touching no top,
 * does without the depth, and a centring routine skips an axis given as 0.
 */
function routineBlock(
  params: OriginParams,
  ball: number,
  subcode: number
): string {
  const read = originFields(params.routine, params.axes)
  const [x, y] = params.distance.map((value, axis) =>
    read.distance[axis] ? value : 0
  )
  const z = read.depth ? ` Z${mm(params.depth)}` : ""
  return `M${ORIGIN_ROUTINE}.${subcode} D${mm(ball)} X${mm(x)} Y${mm(y)}${z}`
}

/**
 * The Z1 firmware's 3D probing routines (ATCHandler's M480), with a 3D touch probe in T9999, the
 * firmware's tool number for it, and its ball: corners and centres found from where the probe
 * starts, which set the work origin there and report each contact.
 */
export const ROUTINES: ProbingStrategy<"origin", OriginParams, OriginSpecs> = {
  id: "makera-z1/routines",
  task: "origin",
  label: "3D probing (Z1 routines)",
  description:
    "Find a corner or center with the 3D probe and set the work origin there.",
  accepts: ({ touch }) => touch === "xyz",
  refuses: (tool, number) => {
    const ball = ballOf(tool, `${tool.name} in ${toolNumberText(number)}`)
    return ball.ok ? null : ball.error
  },
  parameters: () => ROUTINE_PARAMETERS,
  reads: (params) => originFields(params.routine, params.axes),
  defaults: (_plate, parameters) => defaultOriginParams(parameters),
  generate: ({ params, plate, probe, machine }) => {
    const plan = planOrigin(params, placementContext(plate), ROUTINE_PARAMETERS)
    if (!plan.ok) return plan
    const ball = ballOf(probe.tool, probe.tool.name)
    if (!ball.ok)
      return { ok: false, issues: [ballRefused("ball-refused", ball.error)] }
    const { start, height } = plan
    const subcode = routineSubcode(plan.params.routine, plan.params.corner)
    const lines = [
      ...introduction(plan.params, subcode, probe),
      ...(start.kind === "probe-position" ? positioning(plan.params) : []),
      ...precautions(plan.params),
      ...machine.nc.select(probe),
      ...(start.kind === "anchor" ? anchorTravel(start) : []),
      ...(height === null
        ? []
        : [
            "; Down to the start's height.",
            `G0 Z${formatMillimetres(height)}`,
          ]),
      routineBlock(plan.params, ball.value, subcode),
      "M2",
    ]
    return {
      ok: true,
      program: { nc: `${lines.join("\n")}\n`, reviewLine: null },
    }
  },
}
