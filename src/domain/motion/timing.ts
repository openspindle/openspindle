import { trapezoidDuration } from "./kinematics"
import type { MachineLimits } from "./limits"
import {
  BlockPlanner,
  arcJunction,
  cappedAcceleration,
  cappedRate,
  chordSlots,
  junctionDeviation,
  lineSlots,
} from "./planner"
import type { PlannedBlock, PlannerInput } from "./planner"
import { MOVE_KIND } from "./types"
import type { PlanTiming, TimingInput } from "./types"

/** Moves shorter than this (mm) make no block (Robot::append_milestone). */
const MIN_LENGTH = 1e-5
/** How long the player takes to read a program line, in seconds: the Z1 simulator's `lineMs`. */
const LINE_READ = 0.002

/** A move's unit direction, of its `length`. */
function directionOf(input: TimingInput, index: number, length: number) {
  const { from, to } = input
  const at = index * 3
  return [
    (to[at] - from[at]) / length,
    (to[at + 1] - from[at + 1]) / length,
    (to[at + 2] - from[at + 2]) / length,
  ] as const
}

/**
 * The radius of the arc two chords of it on the same line turn on, from the angle between them;
 * null when they do not turn.
 */
function turnRadius(
  input: TimingInput,
  lengths: Float64Array,
  before: number,
  after: number
): number | null {
  const { kind, line } = input
  if (
    before < 0 ||
    after >= input.count ||
    kind[before] !== MOVE_KIND.arc ||
    kind[after] !== MOVE_KIND.arc ||
    line[before] !== line[after] ||
    lengths[before] < MIN_LENGTH ||
    lengths[after] < MIN_LENGTH
  )
    return null
  const [ax, ay, az] = directionOf(input, before, lengths[before])
  const [bx, by, bz] = directionOf(input, after, lengths[after])
  const angle = Math.acos(
    Math.min(1, Math.max(-1, ax * bx + ay * by + az * bz))
  )
  if (angle < 1e-6) return null
  return (lengths[before] + lengths[after]) / 2 / (2 * Math.sin(angle / 2))
}

/**
 * Whether the player streams a move from the program, so that the queue waits to fill before it
 * starts: not a probe's search nor a routine's move, which the firmware starts at once
 * (Conveyor::wait_for_idle). A routine's moves share their block's line, which a program's own
 * move, other than an arc's chords, has to itself.
 */
function streamed(input: TimingInput, index: number) {
  const { kind, line } = input
  if (kind[index] === MOVE_KIND.probe) return false
  if (kind[index] === MOVE_KIND.arc) return true
  return (
    line[index] !== line[index - 1] &&
    (index + 1 >= input.count || line[index] !== line[index + 1])
  )
}

/**
 * When each move of a plan starts and how fast it goes, as the Z1's planner runs them
 * (`BlockPlanner`): its rate as the machine's limits cap it, its junctions by the junction
 * deviation, and its speeds planned over a full queue, which empties where the plan drains. A
 * probe's search stops at its touch without slowing down. Dwells come before the moves they
 * stand before, and after a drain the queue waits to fill before a streamed move.
 */
export function timePlan(
  input: TimingInput,
  limits: MachineLimits
): PlanTiming {
  const { count, from, to, kind, rate, drainBefore, dwellBefore } = input
  const start = new Float64Array(count)
  const duration = new Float32Array(count)
  const entry = new Float32Array(count)
  const cruise = new Float32Array(count)
  const exit = new Float32Array(count)
  const accel = new Float32Array(count)
  const nominal = new Float32Array(count)
  const slots = new Float32Array(count)
  const lengths = new Float64Array(count)
  for (let index = 0; index < count; index++) {
    const at = index * 3
    lengths[index] = Math.hypot(
      to[at] - from[at],
      to[at + 1] - from[at + 1],
      to[at + 2] - from[at + 2]
    )
  }

  const planner = new BlockPlanner<number>(limits)
  const record = (block: PlannedBlock<number> | null) => {
    if (!block) return
    const index = block.payload
    entry[index] = block.entry
    cruise[index] = block.cruise
    exit[index] = block.exit
    accel[index] = block.accel
    nominal[index] = block.nominal * 60
    duration[index] = trapezoidDuration(block)
  }
  const flush = () => {
    for (let block = planner.take(); block; block = planner.take())
      record(block)
  }

  for (let index = 0; index < count; index++) {
    const length = lengths[index]
    const probe = kind[index] === MOVE_KIND.probe
    // A probe's search waits for the queue to empty, and the moves after it for its touch.
    if (
      drainBefore[index] ||
      probe ||
      (index > 0 && kind[index - 1] === MOVE_KIND.probe)
    )
      flush()
    const requested = Math.max(rate[index], 1) / 60
    if (length < MIN_LENGTH) {
      nominal[index] = cappedRate([0, 0, 0], requested, limits) * 60
      accel[index] = limits.acceleration
      slots[index] = 0
      continue
    }
    const direction = directionOf(input, index, length)
    let junction = Infinity
    let blocks = lineSlots(length, limits)
    if (kind[index] === MOVE_KIND.arc) {
      // Inside an arc the firmware's chords, not these, turn into one another.
      const turning = turnRadius(input, lengths, index - 1, index)
      const radius = turning ?? turnRadius(input, lengths, index, index + 1)
      if (turning !== null)
        junction = arcJunction(
          turning,
          cappedAcceleration(direction, limits),
          junctionDeviation(direction, limits),
          limits
        )
      if (radius !== null) blocks = chordSlots(length, radius, limits)
    }
    if (probe) blocks = 1
    slots[index] = blocks
    const move: PlannerInput<number> = {
      length,
      start: direction,
      end: direction,
      rate: requested,
      radius: null,
      junction,
      slots: blocks,
      instant: probe,
      payload: index,
    }
    while (!planner.append(move)) record(planner.take())
  }
  flush()

  // After a drain the queue waits to fill before it starts (Conveyor::check_queue): for the
  // player to read up to the move that fills it or the next block that drains it, which makes it
  // start at once, but no longer than its delay.
  const { line } = input
  const restart = (index: number) => {
    let ahead = 0
    let read = line[index]
    for (let next = index; next < count; next++) {
      if (next > index && drainBefore[next]) {
        read = Math.max(read, line[next] - 1)
        break
      }
      ahead += slots[next]
      read = line[next]
      if (ahead >= limits.queueSize) break
    }
    return Math.min(limits.queueDelay, LINE_READ * (read - line[index] + 1))
  }
  let time = 0
  for (let index = 0; index < count; index++) {
    time += dwellBefore[index]
    if (drainBefore[index] && slots[index] && streamed(input, index))
      time += restart(index)
    start[index] = time
    time += duration[index]
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
