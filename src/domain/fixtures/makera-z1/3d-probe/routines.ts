import { formatMillimetres } from "../../../geometry/millimetres"
import {
  PROBE_3D_AXES_LABELS,
  PROBE_3D_CORNER_LABELS,
  PROBE_3D_ROUTINE_LABELS,
  cornerInward,
  findsCorner,
  probe3dFields,
  setsWorkZ,
} from "../../../probe-3d/params"
import type { Probe3dParameters, Probe3dParams } from "../../../probe-3d/params"
import { probe3dStartOffset } from "../../../probe-3d/rules"
import type { ParameterSpec } from "../../../probing/parameters"
import type { OriginProbing } from "../../../probing/probe"
import { PROBE_3D_TOOL } from "../../../tools/tool-table"
import { anchorTravel } from "../wired-probe/travel"
import { ORIGIN_ROUTINE, routineSubcode } from "./blocks"

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
 * Application limits, not a clearance check. The ball's default is the Makera 3D Probe's; the
 * firmware's own defaults are 20 mm distances and a 2 mm depth.
 */
const PROBE_3D_PARAMETERS: Probe3dParameters = {
  ballDiameter: {
    label: "Ball diameter",
    unit: "mm",
    default: 2,
    min: 0.5,
    max: 10,
    step: 0.1,
    description:
      "The stylus's ball: each side it touches is set half of it beyond the ball's centre. The Makera 3D Probe's is 2 mm.",
  },
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

/** Numbers as the firmware prints its own routines' values: three decimals at most. */
const mm = (value: number) => String(Number(value.toFixed(3)) + 0)

/** What the routine touches, and what it sets. */
function introduction(params: Probe3dParams, subcode: number): string[] {
  const { routine, corner, axes } = params
  const [inX, inY] = cornerInward(corner)
  const sideX = inX > 0 ? "left" : "right"
  const sideY = inY > 0 ? "front" : "back"
  const code = `M${ORIGIN_ROUTINE}.${subcode}`
  const what = PROBE_3D_ROUTINE_LABELS[routine].toLowerCase()
  const title = findsCorner(routine)
    ? `${what}, ${PROBE_3D_CORNER_LABELS[corner].toLowerCase()}`
    : `${what}, ${PROBE_3D_AXES_LABELS[axes].replace(" only", "")}`
  const lines = [`; Makera 3D Probe - 3D probing: ${title}`]
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
function positioning(params: Probe3dParams): string[] {
  const [x, y] = probe3dStartOffset(params).map((value) =>
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
function precautions({ routine, axes }: Probe3dParams): string[] {
  const corner = findsCorner(routine)
  const set = [
    ...(corner || axes !== "y" ? ["X"] : []),
    ...(corner || axes !== "x" ? ["Y"] : []),
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
 * less what the routine does not read (`probe3dFields`): a pocket's centring, touching no top,
 * does without the depth, and a centring routine skips an axis given as 0.
 */
function routineBlock(params: Probe3dParams, subcode: number): string {
  const read = probe3dFields(params.routine, params.axes)
  const [x, y] = params.distance.map((value, axis) =>
    read.distance[axis] ? value : 0
  )
  const z = read.depth ? ` Z${mm(params.depth)}` : ""
  return `M${ORIGIN_ROUTINE}.${subcode} D${mm(params.ballDiameter)} X${mm(x)} Y${mm(y)}${z}`
}

/**
 * The Makera 3D Probe's routines on the Z1 (ATCHandler's M480 with T9999, the firmware's tool
 * number for it): corners and centres found from where the probe starts, which set the work
 * origin there and report each contact.
 */
export const THREE_D_PROBE: OriginProbing = {
  parameters: PROBE_3D_PARAMETERS,
  program({ params, start, height }) {
    const subcode = routineSubcode(params.routine, params.corner)
    const lines = [
      ...introduction(params, subcode),
      ...(start.kind === "probe-position" ? positioning(params) : []),
      ...precautions(params),
      "M5",
      "G21 G90",
      `M6 T${PROBE_3D_TOOL}`,
      ...(start.kind === "anchor" ? anchorTravel(start) : []),
      ...(height === null
        ? []
        : [
            "; Down to the start's height.",
            `G0 Z${formatMillimetres(height)}`,
          ]),
      routineBlock(params, subcode),
    ]
    const probeLine = lines.length
    lines.push("M2")
    return { nc: `${lines.join("\n")}\n`, probeLine, reviewLine: null }
  },
}
