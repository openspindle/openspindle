import type { GCodeProgram, GCodeSegment, Point3 } from "./gcode"

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

/**
 * How far off (mm) a point may be for each second of the program's moves it lies from where
 * playback is, to count as near: the next point along the path wins over a point as near that
 * the path comes back over later, or went through before.
 */
const MM_PER_SECOND_AWAY = 5

/** The moves a source line makes: indices [first, end) into the program's segments. */
function lineMoves({ segments }: GCodeProgram, line: number) {
  let first = 0
  let high = segments.length
  while (first < high) {
    const middle = (first + high) >>> 1
    if (segments[middle].line < line) first = middle + 1
    else high = middle
  }
  let end = first
  while (end < segments.length && segments[end].line === line) end++
  return { first, end }
}

/** Where along a straight move (0 to 1) it comes nearest to `point`, and how near. */
function nearestAlong({ start, end }: GCodeSegment, point: Point3) {
  const delta = [end[0] - start[0], end[1] - start[1], end[2] - start[2]]
  const length = delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2
  const along =
    length > 0
      ? delta.reduce(
          (sum, value, axis) => sum + (point[axis] - start[axis]) * value,
          0
        ) / length
      : 1
  const fraction = Math.max(0, Math.min(1, along))
  const distance = Math.hypot(
    ...delta.map((value, axis) => start[axis] + value * fraction - point[axis])
  )
  return { fraction, distance }
}

/**
 * When, in the program's timed moves, a machine reporting `line` is at one of `positions`
 * (program coordinates, however they were read): the point of that line's moves nearest to it
 * and to where playback is (`after`, else the line's start; `MM_PER_SECOND_AWAY`), so a path
 * that passes the same place twice is followed along; where the moves before it end when the
 * line makes none.
 */
export function timeAtPosition(
  program: GCodeProgram,
  timed: MoveTimes,
  line: number,
  positions: readonly Point3[],
  after: number | null
): number {
  const { first, end } = lineMoves(program, line)
  const start = timeAfterMoves(timed, first)
  if (first === end || !positions.length) return start
  const playback = after ?? start
  let best = { cost: Infinity, time: start }
  for (let index = first; index < end; index++) {
    const began = timeAfterMoves(timed, index)
    for (const position of positions) {
      const { fraction, distance } = nearestAlong(
        program.segments[index],
        position
      )
      const time = began + fraction * (timed.ends[index] - began)
      const cost = distance + Math.abs(time - playback) * MM_PER_SECOND_AWAY
      if (cost < best.cost) best = { cost, time }
    }
  }
  return best.time
}
