import type { MachineLimits } from "./limits"
import type { PlanTiming, TimingInput } from "./types"

/** How small (of a move's length) a move along an axis is before that axis's rate binds it. */
const AXIS_SHARE = 1e-5

/**
 * How fast a move goes, in mm/s: at its rate, but for any axis that would go faster than its own
 * rate and the path faster than the machine's (Robot::append_milestone).
 */
function cappedSpeed(
  delta: readonly [number, number, number],
  length: number,
  rate: number,
  limits: MachineLimits
) {
  let speed = Math.max(rate, 1) / 60
  delta.forEach((distance, axis) => {
    const share = Math.abs(distance) / length
    if (share > AXIS_SHARE)
      speed = Math.min(speed, limits.axisRate[axis] / 60 / share)
  })
  if (limits.pathRate !== null) speed = Math.min(speed, limits.pathRate / 60)
  return speed
}

/**
 * When each move of a plan starts and how fast it goes: each at its rate as the machine's limits
 * cap it, the whole move at that speed, after the dwells before it. Acceleration, junctions and
 * the planner's queue are left out, so moves take less time than the machine needs for them.
 */
export function timePlan(
  input: TimingInput,
  limits: MachineLimits
): PlanTiming {
  const { count, from, to, rate, dwellBefore } = input
  const start = new Float64Array(count)
  const duration = new Float32Array(count)
  const entry = new Float32Array(count)
  const cruise = new Float32Array(count)
  const exit = new Float32Array(count)
  const accel = new Float32Array(count).fill(limits.acceleration)
  const nominal = new Float32Array(count)
  let time = 0
  for (let index = 0; index < count; index++) {
    const at = index * 3
    const delta = [
      to[at] - from[at],
      to[at + 1] - from[at + 1],
      to[at + 2] - from[at + 2],
    ] as const
    const length = Math.hypot(...delta)
    const speed = cappedSpeed(delta, length, rate[index], limits)
    time += dwellBefore[index]
    start[index] = time
    duration[index] = length / speed
    entry[index] = cruise[index] = exit[index] = speed
    nominal[index] = speed * 60
    time += length / speed
  }
  return {
    start,
    duration,
    entry,
    cruise,
    exit,
    accel,
    nominal,
    total: time + input.dwellAfterLast,
  }
}
