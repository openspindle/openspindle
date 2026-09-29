import type { GCodeProgram, GCodeSegment } from "./gcode"

/** When a program's moves end, each at its feed from the program's start, in seconds. */
export type MoveTimes = {
  readonly ends: Float64Array
  /** The whole program's moves, in seconds. */
  readonly duration: number
}

/** Where playback is: the move under way, and how far along it, from 0 to 1. */
export type Playhead = { readonly segment: number; readonly fraction: number }

const times = new WeakMap<GCodeProgram, MoveTimes>()

const seconds = ({ start, end, feed }: GCodeSegment) =>
  (Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) * 60) /
  Math.max(feed, 1)

/**
 * A program's moves timed at their feeds (mm/min), rapids at the rate their parse gives them:
 * what playback simulates. It is not the machine's cycle time, which acceleration, dwells and
 * waiting at tool changes and pauses add to. Cached per program.
 */
export function moveTimes(program: GCodeProgram): MoveTimes {
  const cached = times.get(program)
  if (cached) return cached
  const ends = new Float64Array(program.segments.length)
  let time = 0
  program.segments.forEach((segment, index) => {
    time += seconds(segment)
    ends[index] = time
  })
  const timed = { ends, duration: time }
  times.set(program, timed)
  return timed
}

/**
 * Where playback is `time` seconds into the program's moves: the move under way, or at the end
 * of one, the start of the next.
 */
export function playheadAt(
  { ends, duration }: MoveTimes,
  time: number
): Playhead {
  if (!ends.length) return { segment: 0, fraction: 0 }
  const at = Math.max(0, Math.min(duration, time))
  let low = 0
  let high = ends.length - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (ends[middle] <= at) low = middle + 1
    else high = middle
  }
  const start = low ? ends[low - 1] : 0
  const span = ends[low] - start
  return { segment: low, fraction: span > 0 ? (at - start) / span : 1 }
}

/** When playback has made the program's first `count` moves. */
export const timeAfterMoves = ({ ends }: MoveTimes, count: number) =>
  count > 0 ? ends[Math.min(count, ends.length) - 1] : 0
