/*
 * The Z1's planner, as Smoothieware plans moves (Robot.cpp, Planner.cpp, Block.cpp,
 * Conveyor.cpp): each block's nominal speed and acceleration from the machine's limits, the
 * speed it may turn into the next block at (junction deviation), and the speeds it enters and
 * leaves each block at, planned backwards and forwards over the queue each time a block is
 * added. A block's speeds are final once the machine starts it. Lengths in millimetres, speeds
 * in mm/s, times in seconds.
 *
 * Only relative imports, so the Z1 simulator can use it as it is.
 */
import type { Trapezoid } from "./kinematics.ts"
import type { MachineLimits } from "./limits.ts"

/** A unit direction, X Y Z. */
export type Direction = readonly [number, number, number]

/** A move for the planner to queue. */
export type PlannerInput<T> = {
  /** Along the move, an arc's along its curve; more than 0. */
  readonly length: number
  /** The direction it starts in: the junction before it turns into it. */
  readonly start: Direction
  /** The direction it ends in: the junction after it turns out of it. A line's is its start. */
  readonly end: Direction
  /** mm/s as requested, with the override where it applies, before the machine's limits. */
  readonly rate: number
  /** An arc's radius, whose chords' junctions cap its speed; null for a line, or an arc of one chord. */
  readonly radius: number | null
  /** mm/s: the most it may enter at besides its junction (a chord inside an arc); Infinity for none. */
  readonly junction: number
  /** How many of the queue's blocks the firmware cuts it into (`lineSlots`, `arcSlots`, `chordSlots`). */
  readonly slots: number
  /**
   * A probe's search: the touch stops the motors where it is (ZProbe), so it does not slow
   * down at its end, and the block after it starts from rest.
   */
  readonly instant: boolean
  readonly payload: T
}

/** A block as the machine runs it. */
export type PlannedBlock<T> = Trapezoid & {
  /** mm/s: the speed it is planned to cruise at, which the status reports (F:). */
  readonly nominal: number
  readonly payload: T
}

/** A block in the planner's queue, with the fields Block.cpp plans it by. */
type Block<T> = {
  length: number
  nominal: number
  accel: number
  maxEntry: number
  entry: number
  /** The exit speed its trapezoid was last calculated with (`exit_speed`). */
  exit: number
  /** The peak speed of that trapezoid (`maximum_rate`). */
  cruise: number
  recalculate: boolean
  nominalLength: boolean
  ticking: boolean
  instant: boolean
  slots: number
  payload: T
}

/** The share of a move along an axis below which the axis does not count (Robot.cpp). */
const AXIS_SHARE = 1e-5
/** The cosine past which a junction goes straight on (-) or back (+), which the deviation does not bound. */
const STRAIGHT = 0.9999
/** The most blocks one move is cut into that the queue keeps apart. */
const MAX_SLOTS = 32

/** Robot::append_milestone: how fast a move goes, no axis faster than its rate and the path no faster than the machine's. */
export function cappedRate(
  direction: Direction,
  rate: number,
  limits: MachineLimits
): number {
  let speed = rate
  for (let axis = 0; axis < 3; axis++) {
    const share = Math.abs(direction[axis])
    if (share > AXIS_SHARE)
      speed = Math.min(speed, limits.axisRate[axis] / 60 / share)
  }
  if (limits.pathRate !== null) speed = Math.min(speed, limits.pathRate / 60)
  return speed
}

/**
 * Robot::append_milestone: a move's acceleration, the machine's less where an axis with an
 * acceleration of its own would go faster than that, X then Y then Z.
 */
export function cappedAcceleration(
  direction: Direction,
  limits: MachineLimits
): number {
  let acceleration = limits.acceleration
  for (let axis = 0; axis < 3; axis++) {
    const own = limits.axisAcceleration[axis]
    const share = Math.abs(direction[axis])
    if (own !== null && share > AXIS_SHARE && share * acceleration > own)
      acceleration *= own / (share * acceleration)
  }
  return acceleration
}

/**
 * Robot::append_arc: how long the firmware's chords of an arc of `radius` are, `mm_per_arc_segment`
 * or longer where `mm_max_arc_error` allows.
 */
export function arcChord(radius: number, limits: MachineLimits): number {
  let chord = limits.arcSegment
  const error = limits.arcError
  if (error > 0 && 2 * radius > error)
    chord = Math.max(chord, 2 * Math.sqrt(error * (2 * radius - error)))
  return chord < 0.0001 ? 0.5 : chord
}

/** The junction deviation the junction into a move turns by: `z_junction_deviation` for one along Z alone, when set. */
export function junctionDeviation(
  direction: Direction,
  limits: MachineLimits
): number {
  const alongZ =
    Math.abs(direction[0]) <= AXIS_SHARE && Math.abs(direction[1]) <= AXIS_SHARE
  return alongZ && limits.zJunctionDeviation !== null
    ? limits.zJunctionDeviation
    : limits.junctionDeviation
}

/**
 * Planner::append_block: the most a junction lets the machine turn at, from the cosine of the
 * angle between the two directions (1 for a reversal, -1 for straight on); Infinity when the
 * deviation does not limit it.
 */
function deviationSpeed(
  cosine: number,
  acceleration: number,
  deviation: number
): number {
  if (cosine < -STRAIGHT) return Infinity
  const sinHalf = Math.sqrt(0.5 * (1 - cosine))
  return Math.sqrt((acceleration * deviation * sinHalf) / (1 - sinHalf))
}

/**
 * The most the firmware's chords of an arc of `radius` let it go, where each turns into the
 * next by the angle a chord spans; Infinity where the junction deviation is off.
 */
export function arcJunction(
  radius: number,
  acceleration: number,
  deviation: number,
  limits: MachineLimits
): number {
  if (deviation <= 0 || radius <= 0) return Infinity
  const angle = arcChord(radius, limits) / radius
  return deviationSpeed(-Math.cos(angle), acceleration, deviation)
}

/** How many slots `blocks` of the firmware's take in the queue: one at least, and no more than it keeps apart. */
const slotsOf = (blocks: number) => Math.min(MAX_SLOTS, Math.max(1, blocks))

/** How many blocks the firmware cuts a line into: lengths of `mm_per_line_segment`. */
export function lineSlots(length: number, limits: MachineLimits): number {
  return limits.lineSegment > 0
    ? slotsOf(Math.ceil(length / limits.lineSegment))
    : 1
}

/** How many blocks the firmware cuts a whole arc of `radius` into: its chords. */
export function arcSlots(
  length: number,
  radius: number,
  limits: MachineLimits
): number {
  return slotsOf(Math.floor(length / arcChord(radius, limits)))
}

/**
 * How many of the firmware's chords of an arc of `radius` a part of it as long as `length` comes
 * to, a fraction of one for a part shorter than a chord.
 */
export function chordSlots(
  length: number,
  radius: number,
  limits: MachineLimits
): number {
  return Math.min(MAX_SLOTS, length / arcChord(radius, limits))
}

/** Planner::max_allowable_speed: how fast it may go to reach `target` over `distance` at `acceleration`. */
const allowableSpeed = (
  acceleration: number,
  target: number,
  distance: number
) => Math.sqrt(target * target + 2 * acceleration * distance)

/**
 * Smoothieware's planner queue for blocks carrying `T`. Blocks are appended as the firmware
 * appends them, each planned with every block in the queue (Planner::append_block and
 * recalculate); `take` starts the oldest, whose speeds are then final. The queue counts slots
 * as the firmware's ring of `planner_queue_size` blocks would hold them: the block that runs and
 * the next take one each, as only their last blocks are left in it by the time the next must be
 * known, and every later move takes the blocks it is cut into.
 */
export class BlockPlanner<T> {
  private readonly limits: MachineLimits
  /** The queue from `first`: the block the machine runs, when it runs one, then those it has not started. */
  private blocks: Block<T>[] = []
  private first = 0
  private ticking = false
  /** The slots of the blocks not started. */
  private waitingSlots = 0
  /** The direction the last block appended ends in (`previous_unit_vec`). */
  private previous: Direction = [0, 0, 0]

  constructor(limits: MachineLimits) {
    this.limits = limits
  }

  /** How many blocks are queued and not started. */
  get queued(): number {
    return this.blocks.length - this.first - (this.ticking ? 1 : 0)
  }

  /** The queue's slots in use. */
  get slots(): number {
    const running = this.ticking ? 1 : 0
    const queued = this.queued
    if (!queued) return running
    const next = this.blocks[this.first + running]
    return running + 1 + this.waitingSlots - next.slots
  }

  get full(): boolean {
    return this.slots >= this.limits.queueSize
  }

  /** Plans a move into the queue; false when the queue is full. */
  append(input: PlannerInput<T>): boolean {
    if (this.full) return false
    const { limits } = this
    const { length, start, radius } = input
    const deviation = junctionDeviation(start, limits)
    let accel: number
    let nominal: number
    if (radius === null) {
      accel = cappedAcceleration(start, limits)
      nominal = cappedRate(start, input.rate, limits)
    } else {
      // Somewhere along it an arc runs along X, and somewhere along Y.
      const across = Math.hypot(start[0], start[1])
      const alongX: Direction = [across, 0, start[2]]
      const alongY: Direction = [0, across, start[2]]
      accel = Math.min(
        cappedAcceleration(alongX, limits),
        cappedAcceleration(alongY, limits)
      )
      nominal = Math.min(
        cappedRate(alongX, input.rate, limits),
        cappedRate(alongY, input.rate, limits),
        arcJunction(radius, accel, deviation, limits)
      )
    }

    // Planner::append_block: the junction from the block before, which a probe's touch ends.
    const minimum = limits.minimumSpeed
    let maxEntry = minimum
    const before = this.blocks.length > this.first ? this.blocks.at(-1) : null
    if (before && !before.instant && deviation > 0 && before.nominal > 0) {
      const [x, y, z] = this.previous
      const cosine = -x * start[0] - y * start[1] - z * start[2]
      if (cosine <= STRAIGHT)
        maxEntry = Math.min(
          before.nominal,
          nominal,
          input.junction,
          deviationSpeed(cosine, accel, deviation)
        )
    }
    const allowable = allowableSpeed(accel, minimum, length)
    this.blocks.push({
      length,
      nominal,
      accel,
      maxEntry,
      entry: Math.min(maxEntry, allowable),
      exit: 0,
      cruise: 0,
      recalculate: true,
      nominalLength: nominal <= allowable,
      ticking: false,
      instant: input.instant,
      slots: input.slots,
      payload: input.payload,
    })
    this.waitingSlots += input.slots
    this.previous = input.end
    this.recalculate()
    return true
  }

  /**
   * The oldest block not started, its speeds final, as the machine starts it; the block it ran
   * before has ended. Null when none is queued: the queue is then empty, and the next block
   * appended starts from rest.
   */
  take(): PlannedBlock<T> | null {
    if (this.ticking) {
      this.first++
      this.ticking = false
    }
    if (this.first > 1024 && this.first * 2 > this.blocks.length) {
      this.blocks = this.blocks.slice(this.first)
      this.first = 0
    }
    if (this.first === this.blocks.length) {
      this.blocks.length = 0
      this.first = 0
      return null
    }
    const block = this.blocks[this.first]
    // Conveyor::get_next_block: a block that runs is no longer planned.
    block.ticking = true
    block.recalculate = false
    this.ticking = true
    this.waitingSlots -= block.slots
    if (block.instant) {
      block.cruise = Math.min(
        block.nominal,
        allowableSpeed(block.accel, block.entry, block.length)
      )
      block.exit = block.cruise
    }
    return block
  }

  /** Empties the queue, as a halt flushes it: blocks not started are dropped, and the next starts from rest. */
  drain() {
    this.blocks = []
    this.first = 0
    this.ticking = false
    this.waitingSlots = 0
  }

  /**
   * Planner::recalculate: back from the newest block, each as fast as it may enter and still
   * slow down in time, until one that cannot enter faster than it does; then forwards, each no
   * faster than the one before lets it, and each block's trapezoid from its entry and the
   * next's. The newest ends at the minimum speed.
   */
  private recalculate() {
    const { blocks, first } = this
    const minimum = this.limits.minimumSpeed
    const head = blocks.length - 1
    let index = head
    let current = blocks[index]
    if (head > first) {
      let entry = minimum
      while (index !== first && current.recalculate) {
        entry = reversePass(current, entry)
        index--
        current = blocks[index]
      }
      let exit = maxExitSpeed(current)
      while (index !== head) {
        const previous = current
        index++
        current = blocks[index]
        exit = forwardPass(current, exit)
        calculateTrapezoid(previous, previous.entry, current.entry)
      }
    }
    calculateTrapezoid(current, current.entry, minimum)
  }
}

/** Block::reverse_pass: as fast as it may enter and still reach `exit` by its end. */
function reversePass<T>(block: Block<T>, exit: number): number {
  if (block.entry !== block.maxEntry) {
    if (!block.nominalLength && block.maxEntry > exit) {
      block.entry = Math.min(
        allowableSpeed(block.accel, exit, block.length),
        block.maxEntry
      )
      return block.entry
    }
    block.entry = block.maxEntry
  }
  return block.entry
}

/** Block::forward_pass: no faster than the block before can leave at; returns how fast it can leave. */
function forwardPass<T>(block: Block<T>, previousExit: number): number {
  const exit = Math.min(previousExit, block.nominal, block.maxEntry)
  if (exit <= block.entry) {
    block.entry = exit
    block.recalculate = false
  }
  return maxExitSpeed(block)
}

/** Block::max_exit_speed: a running block's planned exit; otherwise as fast as it can reach. */
function maxExitSpeed<T>(block: Block<T>): number {
  if (block.ticking) return block.exit
  if (block.nominalLength) return block.nominal
  return Math.min(
    allowableSpeed(block.accel, block.entry, block.length),
    block.nominal
  )
}

/** Block::calculate_trapezoid: the peak a block reaches between its entry and exit; a running block keeps its own. */
function calculateTrapezoid<T>(block: Block<T>, entry: number, exit: number) {
  if (block.ticking) return
  block.exit = exit
  block.cruise = Math.max(
    entry,
    exit,
    Math.min(
      block.nominal,
      Math.sqrt(block.accel * block.length + (entry * entry + exit * exit) / 2)
    )
  )
}
