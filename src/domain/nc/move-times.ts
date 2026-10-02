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

/** Where the tool is `time` seconds into the program's moves; null when it makes none. */
export function positionAt(
  program: GCodeProgram,
  timed: MoveTimes,
  time: number
): Point3 | null {
  const { segment, fraction } = playheadAt(timed, time)
  const move = program.segments.at(segment)
  if (!move) return null
  const { start, end } = move
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
    start[2] + (end[2] - start[2]) * fraction,
  ]
}

/** When playback has made the program's first `count` moves. */
export const timeAfterMoves = ({ ends }: MoveTimes, count: number) =>
  count > 0 ? ends[Math.min(count, ends.length) - 1] : 0

/**
 * How fast, at most, a machine goes through its program's moves, in seconds of them per second:
 * faster than they are timed under a feed override.
 */
const MOST_PACE = 2

/**
 * How far off (mm) a point may be for each second of the program's moves it lies beyond where the
 * machine can have got since it was last placed (`MOST_PACE`), to count as near: the next point
 * along the path wins over a point as near that the path comes back over later.
 */
const MM_PER_SECOND_AWAY = 5

/**
 * The same for a point behind where it was last placed (`BACK_SECONDS.free`): the machine only
 * goes on through its program, so a point it went through before wins only when the path ahead
 * comes nowhere near.
 */
const MM_PER_SECOND_BACK = 50

/**
 * The same where the time tells little, only to choose between points about as near: for a
 * machine not placed before, from the start of the moves in reach; otherwise, between a little
 * behind where it was last placed (`BACK_SECONDS.free`) and where it can have got since, from
 * where it would be going on (`GOING_ON_SECONDS`).
 */
const MM_PER_SECOND_UNSURE = 0.01

/**
 * How long (s), at most, a machine is taken to have gone on at the pace its moves are timed at
 * since it was last placed: about as long as between reports. After longer it may as well have
 * waited, such as for a tool change.
 */
const GOING_ON_SECONDS = 0.5

/**
 * How far (s of the program's moves) before where the machine was last placed it may be placed
 * again: a little, as a reading's noise along a slow move, or the path's corners, may have placed
 * it a little ahead; and how far of that does not count as behind it.
 */
const BACK_SECONDS = { most: 1, free: 0.25 } as const

/**
 * How far along a move, at most, a machine at its end is placed: still on it, made with its tool,
 * rather than at the start of the next, which a tool change may make with another.
 */
const AT_END = 1 - 1e-6

/**
 * How long (s of the program's moves) feed moves may take and still pass unreported: the
 * firmware takes the line of the feed move under way only when a status report asks for it,
 * about every 250 ms while a job runs.
 */
const UNREPORTED_FEED_SECONDS = 0.5

/** The index of the first move a source line at or after `line` makes. */
function firstMoveFrom({ segments }: GCodeProgram, line: number) {
  let low = 0
  let high = segments.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (segments[middle].line < line) low = middle + 1
    else high = middle
  }
  return low
}

/** Whether a machine's firmware reports a move's own line while it runs: a feed move's. */
const reportsOwnLine = ({ rapid, routine }: GCodeSegment) => !rapid && !routine

/** What a machine's firmware reports while a program's moves run, as the Z1's does. */
type Reports = {
  /**
   * The line it reports during each move (Smoothieware's `P:` line): a feed move's own (G1, G2
   * or G3, in machine coordinates too); rapids, probing and the firmware's routines leave the
   * line before them, 0 before any.
   */
  readonly lines: Uint32Array
  /**
   * The first move it makes with a tool it reports: Run leaves it none until its first tool
   * change measures one, from the program's first touch on. The program's length when nothing
   * touches.
   */
  readonly firstTouch: number
}

const reports = new WeakMap<GCodeProgram, Reports>()

/**
 * What a machine's firmware reports while a program's moves run, for a program read with the
 * machine's firmware, whose routines' moves it tells apart (`GCodeSegment.routine`). Cached per
 * program.
 */
function reportsOf(program: GCodeProgram): Reports {
  const cached = reports.get(program)
  if (cached) return cached
  const { segments } = program
  const lines = new Uint32Array(segments.length)
  let line = 0
  segments.forEach((segment, index) => {
    if (reportsOwnLine(segment)) line = segment.line
    lines[index] = line
  })
  const touch = segments.findIndex((segment) => segment.probing)
  const made = { lines, firstTouch: touch < 0 ? segments.length : touch }
  reports.set(program, made)
  return made
}

/**
 * The moves a machine reporting `line` may be making, indices [first, end) into the program's
 * segments: from the line's own, those that report what the first does, and on into later lines'
 * for as long as their feed moves may have passed unreported (`UNREPORTED_FEED_SECONDS`).
 */
function movesReporting(program: GCodeProgram, timed: MoveTimes, line: number) {
  const { segments } = program
  const { lines } = reportsOf(program)
  const first = firstMoveFrom(program, line)
  if (first === segments.length) return { first, end: first }
  let end = first + 1
  let high = segments.length
  while (end < high) {
    const middle = (end + high) >>> 1
    if (lines[middle] <= lines[first]) end = middle + 1
    else high = middle
  }
  let unreported = 0
  while (end < segments.length && unreported <= UNREPORTED_FEED_SECONDS) {
    if (reportsOwnLine(segments[end]))
      unreported += timed.ends[end] - timeAfterMoves(timed, end)
    end++
  }
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
 * How far off (mm) a move made with another tool than the one the machine holds counts as, when
 * a move in reach is made with that one: the setter and the change position are visited at every
 * tool change, by each tool in turn.
 */
const MM_OTHER_TOOL = 200

/** Where a machine was last placed in a program's timed moves (`timeAtPosition`). */
export type LastPlacement = {
  /** When, in seconds of the moves. */
  readonly time: number
  /** How long ago, in seconds. */
  readonly since: number
}

/** What a machine report says about where it is in a program. */
export type MachineReport = {
  /** The line it reports. */
  readonly line: number
  /** Where it is, in program coordinates, however they were read. */
  readonly positions: readonly Point3[]
  /**
   * The tool in its spindle; -1 for none, as from Run until a tool is measured, and from
   * confirming a manual tool change until the new tool is; null when unknown.
   */
  readonly tool: number | null
  /** The tool a manual tool change is for; null when unknown. */
  readonly requestedTool: number | null
}

/**
 * When, in the program's timed moves, a machine making `report` is: the point of the moves in
 * reach nearest to where it is, made with the tool it holds, and to where it can have got since it
 * was last placed (`last`; `MM_PER_SECOND_AWAY`, and far more behind it), so that a path that
 * passes the same place twice is followed along; where the moves before them end when there are
 * none. The machine reports the line of the feed move under way or last (`Reports.lines`), so its
 * rapids, probing and routines after it leave the report behind: the moves in reach are those
 * that may report the line (`movesReporting`), from a little before where it was last placed on
 * (`BACK_SECONDS`), unless the line puts it before there. Holding no tool, it makes the moves
 * before its first tool is measured (`Reports.firstTouch`), or a manual tool change measures the
 * tool it is for, which the change's moves are made with.
 */
export function timeAtPosition(
  program: GCodeProgram,
  timed: MoveTimes,
  { line, positions, tool, requestedTool }: MachineReport,
  last: LastPlacement | null
): number {
  const reach = movesReporting(program, timed, line)
  const { end } = reach
  const start = timeAfterMoves(timed, reach.first)
  if (reach.first === end) return start
  if (!positions.length) return Math.max(start, last?.time ?? start)
  const from = last
    ? playheadAt(timed, last.time - BACK_SECONDS.most).segment
    : end
  // Moves in reach that all lie before where it was last placed correct that: it is placed anew.
  const placed = from < end ? last : null
  const first = placed ? Math.max(reach.first, from) : reach.first
  const { firstTouch } = reportsOf(program)
  const madeWithTool = (index: number) =>
    tool === -1
      ? index < firstTouch || program.segments[index].tool === requestedTool
      : program.segments[index].tool === tool
  let known = false
  for (let index = first; index < end && !known; index++)
    known = madeWithTool(index)
  const away = (time: number) => {
    if (!placed) return (time - start) * MM_PER_SECOND_UNSURE
    const behind = placed.time - BACK_SECONDS.free
    const beyond = placed.time + placed.since * MOST_PACE
    if (time < behind) return (behind - time) * MM_PER_SECOND_BACK
    if (time > beyond) return (time - beyond) * MM_PER_SECOND_AWAY
    const going = placed.time + Math.min(placed.since, GOING_ON_SECONDS)
    return Math.abs(time - going) * MM_PER_SECOND_UNSURE
  }
  let best = { cost: Infinity, time: start }
  for (let index = first; index < end; index++) {
    const segment = program.segments[index]
    const began = timeAfterMoves(timed, index)
    for (const position of positions) {
      const { fraction, distance } = nearestAlong(segment, position)
      const time =
        began + Math.min(fraction, AT_END) * (timed.ends[index] - began)
      const cost =
        distance +
        (known && !madeWithTool(index) ? MM_OTHER_TOOL : 0) +
        away(time)
      if (cost < best.cost) best = { cost, time }
    }
  }
  return best.time
}
