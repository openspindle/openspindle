/*
 * How fast a machine moves and where it stops between moves, as its firmware's planner has it.
 *
 * Nothing imported, so the Z1 simulator can use it as it is.
 */

/** A machine's motion limits, from its configuration or its kit's defaults. */
export type MachineLimits = {
  /** "<kit id>:defaults" | "<kit id>:config:<revision>" */
  readonly key: string
  /** default_seek_rate, mm/min */
  readonly seek: number
  /** default_feed_rate, mm/min */
  readonly feed: number
  /** min(<a>_max_rate, <x>_axis_max_speed), mm/min */
  readonly axisRate: readonly [number, number, number]
  /** max_speed (mm/min); null if unset/≤0 */
  readonly pathRate: number | null
  /** mm/s² */
  readonly acceleration: number
  /** <a>_acceleration; z_acceleration fallback */
  readonly axisAcceleration: readonly [
    number | null,
    number | null,
    number | null,
  ]
  /** mm */
  readonly junctionDeviation: number
  readonly zJunctionDeviation: number | null
  /** minimum_planner_speed, mm/s */
  readonly minimumSpeed: number
  /** planner_queue_size */
  readonly queueSize: number
  /** queue_delay_time_ms / 1000 */
  readonly queueDelay: number
  /** mm_per_line_segment, 0 = none */
  readonly lineSegment: number
  /** mm_per_arc_segment */
  readonly arcSegment: number
  /** mm_max_arc_error */
  readonly arcError: number
  /** s */
  readonly spindleDelay: { readonly on: number; readonly off: number }
}

/** A word of an NC block: its letter, upper case, and its value. */
export type NcWordLike = { readonly letter: string; readonly value: number }

/** What a block makes the machine do between moves. */
export type MotionStop = {
  /** queue empties before the block's moves */
  readonly drain: boolean
  /** s standing still after the drain */
  readonly dwell: number
  /** waits for the user (tool waits come from routine moves) */
  readonly wait: "pause" | null
  /** spindle state after it (M3/M4 → true, M5 → false) */
  readonly spindle: boolean | null
}

/** How a kind of machine moves: its limits, and the blocks that stop it between moves. */
export interface MotionModel {
  readonly defaults: MachineLimits
  /** The limits a machine's configuration sets, from its text and revision; the defaults without. */
  limits: (
    configuration: string | null,
    revision: string | null
  ) => MachineLimits
  /** What a block makes the machine do between moves; null for a block that does not stop it. */
  stop: (
    words: readonly NcWordLike[],
    spindleOn: boolean,
    limits: MachineLimits
  ) => MotionStop | null
}
