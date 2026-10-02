import { moveIndex, planSeconds } from "@/domain/motion/spaces"
import type { PlanSeconds, Vec3 } from "@/domain/motion/spaces"
import type { MotionPlan, PlanIndex } from "@/domain/motion/types"
import type { Estimate } from "@/domain/tracking/types"

/**
 * How far (s of the plan) the time on show may be from where the estimate puts the machine before
 * it goes there at once, rather than along the moves: the follow lost the machine for that long,
 * or a report corrected where it was placed.
 */
const SNAP_SECONDS = 2

/**
 * How fast, at most, the time on show catches up with the estimate: this many times as fast as
 * the machine goes, and at least this many times real time.
 */
const CATCH_UP = 2

/**
 * How far (s of the plan) ahead of the estimate the time on show goes back to it, and how fast (s
 * of the plan per second): a reading's noise along a slow move. Further ahead it waits there for
 * the machine.
 */
const BACK = { most: 0.25, rate: 0.25 } as const

/**
 * How long (s) after its report an estimate is carried on at its rate: a few reports, so that the
 * time on show goes on between them but not far past where the machine last was.
 */
const RECKONED_SECONDS = 1

/** How long (ms) the tool takes to where a report puts it off the moves. */
const TIP_MS = 150

/** The time on show, and where the tool is drawn while a report puts it off the moves. */
export type ClockReading = {
  readonly time: PlanSeconds
  /** Off the moves, the tool's tip on its way to where the machine reported it; null on them. */
  readonly tip: Vec3 | null
  /** Whether the time went where the estimate puts the machine at once. */
  readonly snapped: boolean
}

/** Each plan's tool changes: for each move, the first after it made with another tool. */
const changes = new WeakMap<MotionPlan, Int32Array>()

/** The first move after `move` made with another tool than it; the plan's length for none. */
function nextToolChange(plan: MotionPlan, move: number) {
  let next = changes.get(plan)
  if (!next) {
    next = new Int32Array(plan.count)
    let change = plan.count
    for (let index = plan.count - 1; index >= 0; index--) {
      next[index] = change
      if (index > 0 && plan.tool[index - 1] !== plan.tool[index]) change = index
    }
    changes.set(plan, next)
  }
  return next[move]
}

/** Whether the tool making the moves changes between two times of a plan. */
function toolChangesBetween(index: PlanIndex, from: number, to: number) {
  const first = index.at(planSeconds(Math.min(from, to))).move
  const last = index.at(planSeconds(Math.max(from, to))).move
  return nextToolChange(index.plan, first) <= last
}

const sameVec = (a: Vec3, b: Vec3) =>
  a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/**
 * The time a plan is shown at, frame by frame: following where a tracker's estimate puts a job's
 * machine, or playing on its own. Following, the estimate goes on at its rate for a little while
 * after its report, up to the next place the machine waits for the user or another tool's moves;
 * the time on show catches up with it along the moves at most twice as fast, goes back to it only
 * by a little and slowly, and goes there at once when it is far off or past a tool change, so that
 * a tool is never drawn on another tool's moves. Off the moves it waits where the estimate has the
 * machine, while the tool goes to where the machine reported it. A new clock starts where the
 * estimate is: it keeps nothing of another. Times of `now` are in milliseconds of the clock
 * reports are timed by (`Date.now`).
 */
export class PlaybackClock {
  /** The plan time on show; null before the first frame. */
  private shown: number | null = null
  /** When the last frame was. */
  private last: number | null = null
  /** The tool's way to where the machine was reported off the moves, while it is. */
  private way: {
    readonly from: Vec3
    readonly to: Vec3
    readonly since: number
  } | null = null
  /** Where the tool was last drawn off the moves. */
  private drawn: Vec3 | null = null

  /** The plan time on show; null before the first frame. */
  get time(): PlanSeconds | null {
    return this.shown === null ? null : planSeconds(this.shown)
  }

  /** Shows `time` from the next frame on; null has the next frame go where it follows at once. */
  set(time: number | null) {
    this.shown = time
    this.last = null
    this.way = null
    this.drawn = null
  }

  /** The time stands still until the next frame, which goes on from where it stood. */
  pause() {
    this.last = null
  }

  /** The time on show at `now`, following where `estimate` puts the machine in `index`'s plan. */
  follow(index: PlanIndex, estimate: Estimate, now: number): ClockReading {
    const elapsed = this.seconds(now)
    const off = estimate.status === "off-plan" ? estimate.tip : null
    // Off the moves, the time waits where the estimate has it.
    const target = off ? estimate.time : this.reckoned(index, estimate, now)
    const shown = this.shown
    const snapped =
      shown === null ||
      Math.abs(target - shown) > SNAP_SECONDS ||
      toolChangesBetween(index, shown, target)
    let time = target
    if (!snapped) {
      const forward = CATCH_UP * Math.max(estimate.rate, 1) * elapsed
      if (target > shown) time = Math.min(target, shown + forward)
      else if (shown - target <= BACK.most)
        time = Math.max(target, shown - BACK.rate * elapsed)
      else time = shown
    }
    this.shown = time
    return {
      time: planSeconds(time),
      tip: off ? this.toward(index, off, now) : this.onMoves(),
      snapped,
    }
  }

  /**
   * The time on show at `now`, playing on its own `speed` times as fast as the plan is timed;
   * null once it has played the whole plan.
   */
  play(index: PlanIndex, now: number, speed: number): PlanSeconds | null {
    const time = (this.shown ?? 0) + this.seconds(now) * speed
    this.shown = time
    return time >= index.duration ? null : planSeconds(time)
  }

  /** Seconds since the last frame, which `now` is: none at the first. */
  private seconds(now: number) {
    const elapsed =
      this.last === null ? 0 : Math.max(0, (now - this.last) / 1000)
    this.last = now
    return elapsed
  }

  /**
   * Where the estimate puts the machine at `now`: gone on at its rate since its report, for a
   * little while (`RECKONED_SECONDS`), and not past the next place it waits for the user nor into
   * another tool's moves, which a manual tool change waits before.
   */
  private reckoned(index: PlanIndex, estimate: Estimate, now: number) {
    const { time, rate, move } = estimate
    let most = Math.min(index.duration, time + rate * RECKONED_SECONDS)
    const checkpoint = index.nextCheckpoint(time)
    if (checkpoint) most = Math.min(most, index.timeOf(checkpoint.after, 1))
    const change = nextToolChange(index.plan, move)
    if (change < index.plan.count)
      most = Math.min(most, index.timeOf(moveIndex(change - 1), 1))
    const gone = time + (rate * Math.max(0, now - estimate.at)) / 1000
    return Math.max(time, Math.min(gone, most))
  }

  /** The tool's tip on its way from where it was drawn to `to`, reported off the moves. */
  private toward(index: PlanIndex, to: Vec3, now: number): Vec3 {
    if (!this.way || !sameVec(this.way.to, to))
      this.way = {
        from: this.drawn ?? index.pointAt(planSeconds(this.shown ?? 0)),
        to,
        since: now,
      }
    const { from } = this.way
    const share = Math.min(1, Math.max(0, (now - this.way.since) / TIP_MS))
    const tip: Vec3 = [
      from[0] + (to[0] - from[0]) * share,
      from[1] + (to[1] - from[1]) * share,
      from[2] + (to[2] - from[2]) * share,
    ]
    this.drawn = tip
    return tip
  }

  /** Back on the moves, the tool is drawn on them. */
  private onMoves() {
    this.way = null
    this.drawn = null
    return null
  }
}
