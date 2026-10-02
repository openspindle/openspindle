/**
 * The simulated Z1's motion: the moves the player and the scripts hand over, planned as the
 * firmware's planner plans them (`BlockPlanner`) and run one block after another, each by its
 * trapezoid, as the step ticker runs them. Times are milliseconds on the wall clock; a simulator
 * faster than the machine (`speed`) runs each block that many times faster.
 */
import {
  distanceAt,
  trapezoidDuration,
} from "../../src/domain/motion/kinematics.ts"
import type { MachineLimits } from "../../src/domain/motion/limits.ts"
import {
  BlockPlanner,
  arcChord,
  arcSlots,
  lineSlots,
} from "../../src/domain/motion/planner.ts"
import type {
  Direction,
  PlannedBlock,
} from "../../src/domain/motion/planner.ts"

export type Xyz = [number, number, number]
/** A G2 or G3 arc in X and Y: the centre it turns about and the angle it sweeps. */
export type Arc = { readonly centre: [number, number]; readonly sweep: number }

/** A move the simulator queues. */
export type QueuedMove = {
  readonly from: Xyz
  readonly to: Xyz
  readonly arc: Arc | null
  /** mm/min as requested, with the override where it applies. */
  readonly rate: number
  /** The program line it was read from; 0 for a command's or a routine's. */
  readonly line: number
  /** A G1, G2 or G3 block's: the status reports its line (P:). */
  readonly g123: boolean
  /** A probe's search that touches at its end: the touch stops it at once. */
  readonly touches: boolean
}

/** A block the machine runs: its move, and its number among those queued. */
export type QueueEntry = { readonly move: QueuedMove; readonly index: number }

/** The block under way. */
export type RunningBlock = {
  readonly block: PlannedBlock<QueueEntry>
  readonly startedAt: number
  readonly endsAt: number
  /** How many times faster than the machine it runs. */
  readonly speed: number
}

/** Moves shorter than this (mm) make no block (Robot::append_milestone). */
const MIN_LENGTH = 1e-5

/** The angle a G2 (clockwise) or G3 arc sweeps about `centre`: a whole turn back to its start. */
export function sweepOf(
  from: Xyz,
  to: Xyz,
  centre: [number, number],
  clockwise: boolean
) {
  const start = Math.atan2(from[1] - centre[1], from[0] - centre[0])
  let sweep = Math.atan2(to[1] - centre[1], to[0] - centre[0]) - start
  if (clockwise && sweep >= -1e-9) sweep -= 2 * Math.PI
  if (!clockwise && sweep <= 1e-9) sweep += 2 * Math.PI
  return sweep
}

/** How far a move goes: an arc along its curve. */
function lengthOf({ from, to, arc }: QueuedMove) {
  const dz = to[2] - from[2]
  if (!arc) return Math.hypot(to[0] - from[0], to[1] - from[1], dz)
  const radius = Math.hypot(from[0] - arc.centre[0], from[1] - arc.centre[1])
  return Math.hypot(Math.abs(arc.sweep) * radius, dz)
}

/** Where a move is `fraction` of the way along it. */
function along({ from, to, arc }: QueuedMove, fraction: number): Xyz {
  const z = from[2] + (to[2] - from[2]) * fraction
  if (!arc)
    return [
      from[0] + (to[0] - from[0]) * fraction,
      from[1] + (to[1] - from[1]) * fraction,
      z,
    ]
  const [cx, cy] = arc.centre
  const start = Math.hypot(from[0] - cx, from[1] - cy)
  const radius = start + (Math.hypot(to[0] - cx, to[1] - cy) - start) * fraction
  const angle = Math.atan2(from[1] - cy, from[0] - cx) + arc.sweep * fraction
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), z]
}

/** The direction an arc of `length` runs in at `point`: along its circle, and in Z as it rises. */
function tangent(point: Xyz, move: QueuedMove, arc: Arc, length: number) {
  const rx = point[0] - arc.centre[0]
  const ry = point[1] - arc.centre[1]
  const radius = Math.hypot(rx, ry) || 1
  const dz = move.to[2] - move.from[2]
  const across = Math.sqrt(Math.max(0, 1 - (dz / length) ** 2))
  const turn = Math.sign(arc.sweep)
  return [
    ((-turn * ry) / radius) * across,
    ((turn * rx) / radius) * across,
    dz / length,
  ] as const
}

/**
 * The planner's queue as the conveyor runs it: once the queue empties, the machine waits for
 * it to fill, `queue_delay_time_ms` or a wait for the moves to end (`flush`) before it starts
 * again (Conveyor::check_queue); then each block starts as the one before it ends.
 */
export class MotionQueue {
  private readonly limits: MachineLimits
  private readonly speed: () => number
  private readonly planner: BlockPlanner<QueueEntry>
  private running: RunningBlock | null = null
  /** Moves handed over that the queue has no room for yet: the player waits behind them. */
  private readonly waiting: QueuedMove[] = []
  /** Whether the machine may start the queue's blocks (`allow_fetch`), and from when. */
  private fetching = false
  private fetchingFrom = 0
  /** When the empty queue was last given a block, which it waits to fill from. */
  private filling = 0
  /** When the last block ended. */
  private endedAt = 0
  private queued = 0

  constructor(limits: MachineLimits, speed: () => number) {
    this.limits = limits
    this.speed = speed
    this.planner = new BlockPlanner(limits)
  }

  /** How many moves have been queued, each block's `index` counting from 0. */
  get count(): number {
    return this.queued
  }

  /** Whether the player must wait before it hands over another move. */
  get full(): boolean {
    return this.waiting.length > 0 || this.planner.full
  }

  /** Queues a move at `now`, or once the queue has room for it. A move too short to make a block is left out. */
  push(move: QueuedMove, now: number) {
    this.advance(now)
    if (lengthOf(move) < MIN_LENGTH) return
    if (this.waiting.length || !this.admit(move, now)) this.waiting.push(move)
  }

  /** Makes the machine start what is queued at once, as a wait for the moves to end does. */
  flush(now: number) {
    this.advance(now)
    if (!this.fetching && this.planner.queued) this.fetchFrom(now)
    this.advance(now)
  }

  /** Whether nothing runs or waits to: the machine stands still. */
  idle(now: number): boolean {
    this.advance(now)
    return !this.running && !this.planner.queued && !this.waiting.length
  }

  /** When the last block ended; `since` when none has since. */
  settled(since: number): number {
    return Math.max(this.endedAt, since)
  }

  /** The block under way at `now`. */
  current(now: number): RunningBlock | null {
    this.advance(now)
    return this.running
  }

  /** Where the block under way is at `now`; null when none is. */
  position(now: number): Xyz | null {
    const running = this.current(now)
    if (!running) return null
    const { block } = running
    const seconds = ((now - running.startedAt) / 1000) * running.speed
    const fraction =
      block.length > 0 ? distanceAt(block, seconds) / block.length : 1
    return along(block.payload.move, fraction)
  }

  /** Stops the machine where it is at `now`, as a halt does: every block is dropped. Null when it stood still. */
  stop(now: number): Xyz | null {
    const at = this.position(now)
    this.planner.drain()
    this.running = null
    this.waiting.length = 0
    this.fetching = false
    this.endedAt = now
    return at
  }

  /** Runs the queue up to `now`: each block that has ended gives way to the next. */
  advance(now: number) {
    for (;;) {
      const running = this.running
      if (running) {
        if (running.endsAt > now) return
        this.start(running.endsAt)
        continue
      }
      if (!this.planner.queued) return
      if (!this.fetching) {
        const due =
          this.filling + (this.limits.queueDelay * 1000) / this.speed()
        if (due > now) return
        this.fetchFrom(due)
      }
      this.start(this.fetchingFrom)
      if (!this.running) return
    }
  }

  private fetchFrom(at: number) {
    this.fetching = true
    this.fetchingFrom = at
  }

  /** The block that has ended, if any, gives way to the next at `at`; with none, the queue empties. */
  private start(at: number) {
    const block = this.planner.take()
    if (block) {
      const speed = this.speed()
      this.running = {
        block,
        startedAt: at,
        endsAt: at + (trapezoidDuration(block) * 1000) / speed,
        speed,
      }
    } else {
      this.running = null
      this.fetching = false
      this.endedAt = at
    }
    // The room the block that ended leaves takes the moves that wait for it.
    while (this.waiting.length && this.admit(this.waiting[0], at))
      this.waiting.shift()
  }

  /** Plans a move into the queue at `now`; false when it has no room. */
  private admit(move: QueuedMove, now: number): boolean {
    const { limits } = this
    const length = lengthOf(move)
    const { from, to, arc } = move
    const radius = arc
      ? Math.hypot(from[0] - arc.centre[0], from[1] - arc.centre[1])
      : 0
    // An arc too short for two chords is one: a line to its end.
    const curved =
      arc !== null && Math.floor(length / arcChord(radius, limits)) > 1
    const straight = Math.hypot(
      to[0] - from[0],
      to[1] - from[1],
      to[2] - from[2]
    )
    const chord: Direction = [
      (to[0] - from[0]) / (straight || 1),
      (to[1] - from[1]) / (straight || 1),
      (to[2] - from[2]) / (straight || 1),
    ]
    const empty = !this.running && !this.planner.queued
    const admitted = this.planner.append({
      length,
      start: curved ? tangent(from, move, arc, length) : chord,
      end: curved ? tangent(to, move, arc, length) : chord,
      rate: move.rate / 60,
      radius: curved ? radius : null,
      junction: Infinity,
      slots: move.touches
        ? 1
        : curved
          ? arcSlots(length, radius, limits)
          : lineSlots(length, limits),
      instant: move.touches,
      payload: { move, index: this.queued },
    })
    if (!admitted) return false
    this.queued++
    if (empty) this.filling = now
    if (!this.fetching && this.planner.full) this.fetchFrom(now)
    return true
  }
}
