/*
 * Registration: how the positions a machine reports are compared with its plan. A program's own
 * moves are placed by the work position the machine reports, which is in the program's own
 * coordinates, so it matches the plan once shifted as the plan shifts the move's work offset; the
 * firmware's routines are placed by the machine position, put on the plate by its anchors, which
 * the plate may have a little off. What is left over, per frame, is a bias the tracker learns from
 * the reports on moves it is sure of.
 */
import type { MoveIndex, Vec3 } from "@/domain/motion/spaces"
import { MOVE_FRAME, MOVE_KIND } from "@/domain/motion/types"
import type { PlanIndex } from "@/domain/motion/types"
import type { Observation, TrackerState } from "./types"

/** How far reported tips are off the plan in each frame, and from how many reports. */
export type Registration = TrackerState["bias"]

/** No bias, as at a job's start. */
export const NO_BIAS: Registration = {
  machine: [0, 0, 0],
  work: [0, 0, 0],
  samples: 0,
}

/** How much of each report's offset across a move the bias takes on. */
const BIAS_WEIGHT = 0.2

/**
 * How steep a move may be and still tell the bias in X and Y, and in Z (|u_z|): along a plunge
 * an offset in X or Y is as likely a time error, and along a slope one in Z.
 */
const STEEPEST = { xy: 0.9, z: 0.3 } as const

/** How far (mm) the bias may go in X and Y, and in Z. */
const BIAS_LIMIT = { xy: 5, z: 10 } as const

/** The tool's measuring at a tool change, during which its length is not known yet. */
const MEASURING = -1

/**
 * Whether a report's Z can be compared with a move's: by work position once the program has set
 * work Z, before which the work Z the machine reports is not the plan's; by machine position
 * unless the tool is being measured, as the new tool's length is unknown until it is.
 */
export function comparesZ(index: PlanIndex, move: MoveIndex): boolean {
  const { plan } = index
  return plan.frame[move] === MOVE_FRAME.work
    ? move >= plan.workZFrom
    : plan.reportTool[move] !== MEASURING
}

/**
 * Where a report puts the tool in the plan's coordinates, as a move is placed and less its
 * frame's bias: by work position shifted by the move's work offset (`shiftAt`), or by machine
 * position placed on the plate. A move in machine coordinates is drawn where the tool the plate's
 * setup takes every tool to be (one meeting the tool setter where the probe does) has its tip, so
 * it is compared at the machine position itself, the tool's own offset added back to the tip.
 * Null when the report has no such position.
 */
export function reportedTip(
  index: PlanIndex,
  observation: Observation,
  move: MoveIndex,
  bias: Registration
): Vec3 | null {
  if (index.plan.frame[move] === MOVE_FRAME.machine) {
    const tip = observation.machineTip
    if (!tip) return null
    const offset = observation.toolOffset ?? 0
    return [
      tip[0] - bias.machine[0],
      tip[1] - bias.machine[1],
      tip[2] + offset - bias.machine[2],
    ]
  }
  const tip = observation.workTip
  if (!tip) return null
  const shift = index.shiftAt(move)
  return [0, 1, 2].map(
    (axis) => tip[axis] + shift[axis] - bias.work[axis]
  ) as Vec3
}

/**
 * How far a tip is from where a move has the tool at a fraction of its length, in the parts the
 * move's frame compares (`comparesZ`); Z is 0 where it does not.
 */
export function offsetFrom(
  index: PlanIndex,
  move: MoveIndex,
  fraction: number,
  tip: Vec3
): Vec3 {
  const planned = index.pointOf(move, fraction)
  return [
    tip[0] - planned[0],
    tip[1] - planned[1],
    comparesZ(index, move) ? tip[2] - planned[2] : 0,
  ]
}

/** A move's direction, as a unit vector; null for a move of no length. */
function directionOf(index: PlanIndex, move: MoveIndex): Vec3 | null {
  const { from, to, length } = index.plan
  const size = length[move]
  if (!(size > 0)) return null
  const first = move * 3
  return [0, 1, 2].map(
    (axis) => (to[first + axis] - from[first + axis]) / size
  ) as Vec3
}

const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value))

/**
 * The bias after a report on a move the tracker is sure of: the frame's bias takes on a share
 * (`BIAS_WEIGHT`) of the report's offset across the move, as an offset along it is a time error.
 * X and Y are learnt on moves no steeper than `STEEPEST.xy`, Z on flatter ones than `STEEPEST.z`
 * where the frame compares it, each within its limit (`BIAS_LIMIT`). A probe's search, which
 * stops where it touches, teaches nothing; touches only pin when the machine is.
 */
export function register(
  index: PlanIndex,
  bias: Registration,
  observation: Observation,
  move: MoveIndex,
  fraction: number
): Registration {
  if (!observation.positionTrusted) return bias
  if (index.plan.kind[move] === MOVE_KIND.probe) return bias
  const direction = directionOf(index, move)
  const tip = reportedTip(index, observation, move, bias)
  if (!direction || !tip) return bias
  const offset = offsetFrom(index, move, fraction, tip)
  const along =
    offset[0] * direction[0] +
    offset[1] * direction[1] +
    offset[2] * direction[2]
  const across = offset.map((value, axis) => value - along * direction[axis])
  const steepness = Math.abs(direction[2])
  const learnsXY = steepness < STEEPEST.xy
  const learnsZ = steepness < STEEPEST.z && comparesZ(index, move)
  if (!learnsXY && !learnsZ) return bias
  const machine = index.plan.frame[move] === MOVE_FRAME.machine
  const before = machine ? bias.machine : bias.work
  const after: Vec3 = [
    learnsXY
      ? clamp(before[0] + BIAS_WEIGHT * across[0], BIAS_LIMIT.xy)
      : before[0],
    learnsXY
      ? clamp(before[1] + BIAS_WEIGHT * across[1], BIAS_LIMIT.xy)
      : before[1],
    learnsZ
      ? clamp(before[2] + BIAS_WEIGHT * across[2], BIAS_LIMIT.z)
      : before[2],
  ]
  return machine
    ? { ...bias, machine: after, samples: bias.samples + 1 }
    : { ...bias, work: after, samples: bias.samples + 1 }
}

/**
 * How far a reported contact is from where the plan's search ends, less the machine frame's
 * bias: what the stock or the tool sensor measured differently from the plate's model. Null
 * without the contact's position.
 */
export function contactOffset(
  index: PlanIndex,
  point: Vec3 | null,
  search: MoveIndex,
  bias: Registration
): Vec3 | null {
  if (!point) return null
  const end = index.pointOf(search, 1)
  return [0, 1, 2].map(
    (axis) => point[axis] - bias.machine[axis] - end[axis]
  ) as Vec3
}
