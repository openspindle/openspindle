import type { Point3 } from "@/domain/nc/gcode"
import { isProbeSlot } from "@/domain/tools/tool-table"
import { distanceAt, secondsAt, speedAt } from "./kinematics"
import type { Trapezoid } from "./kinematics"
import { gridOfMoves, visitNear } from "./spatial"
import type { MoveGrid } from "./spatial"
import { moveIndex, planSeconds, sourceLine } from "./spaces"
import type {
  MoveIndex,
  MovePoint,
  MoveRange,
  PlanSeconds,
  SourceLine,
  Vec3,
} from "./spaces"
import { MOVE_KIND } from "./types"
import type { Checkpoint, MotionPlan, PlanIndex } from "./types"

/** The first index in [low, high) whose value `before` is false for, as values only go up. */
function partition(
  low: number,
  high: number,
  before: (index: number) => boolean
) {
  while (low < high) {
    const middle = (low + high) >>> 1
    if (before(middle)) low = middle + 1
    else high = middle
  }
  return low
}

/** UTF-8 bytes of a line of text. */
function utf8Bytes(text: string) {
  let bytes = 0
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    // A surrogate pair is one character of four bytes.
    else if (code >= 0xd800 && code < 0xdc00) {
      bytes += 4
      index++
    } else bytes += 3
  }
  return bytes
}

/** Where each of a program's lines ends, in UTF-8 bytes from its start, line feeds included. */
function lineEnds(lines: readonly string[]) {
  const ends = new Float64Array(lines.length)
  let bytes = 0
  lines.forEach((line, index) => {
    bytes += utf8Bytes(line) + 1
    ends[index] = bytes
  })
  return ends
}

/**
 * For each move, the first from it on that is a probe's search, which it touches in; -1 for
 * none. A tool on the tool setter does not count.
 */
function touchesFrom({ count, kind, tool }: MotionPlan) {
  const touches = new Int32Array(count)
  let next = -1
  for (let index = count - 1; index >= 0; index--) {
    if (kind[index] === MOVE_KIND.probe && isProbeSlot(tool[index]))
      next = index
    touches[index] = next
  }
  return touches
}

/**
 * Queries on a plan: times by binary search on when its moves start, points along moves by their
 * kinematics, and moves near a point through a grid of the moves in XY (`MoveGrid`). What a query
 * needs beyond the plan, such as the grid or where the program's lines end in bytes, is made by
 * its first call. Its queries may be called on their own, apart from the index.
 */
export function indexPlan(plan: MotionPlan): PlanIndex {
  const { count, from, to, length, kind, routine, line, reportLine } = plan
  const { timing, checkpoints, shifts } = plan
  let ends: Float64Array | null = null
  let touches: Int32Array | null = null
  let grid: MoveGrid | null = null
  /** The query each move was last measured for by `near`, so that it is measured once. */
  let measured: Uint32Array | null = null
  let query = 0

  const trapezoid = (move: number): Trapezoid => ({
    length: length[move],
    entry: timing.entry[move],
    cruise: timing.cruise[move],
    exit: timing.exit[move],
    accel: timing.accel[move],
  })

  /** The last move that starts at or before `time`; the first before any. */
  const moveAt = (time: number) =>
    Math.max(0, partition(0, count, (index) => timing.start[index] <= time) - 1)

  const at = (time: PlanSeconds): MovePoint => {
    if (!count) return { move: moveIndex(0), fraction: 0 }
    const move = moveAt(time)
    const along = distanceAt(trapezoid(move), time - timing.start[move])
    return {
      move: moveIndex(move),
      fraction: length[move] > 0 ? along / length[move] : 1,
    }
  }

  const pointOf = (
    move: MoveIndex,
    fraction: number,
    out: Point3 = [0, 0, 0]
  ): Point3 => {
    const first = move * 3
    for (let axis = 0; axis < 3; axis++) {
      const start = from[first + axis]
      out[axis] = start + (to[first + axis] - start) * fraction
    }
    return out
  }

  /** Where along a move (0 to 1) it comes nearest to a point. */
  const nearestFraction = (move: number, point: Point3) => {
    const first = move * 3
    let squared = 0
    let along = 0
    for (let axis = 0; axis < 3; axis++) {
      const delta = to[first + axis] - from[first + axis]
      squared += delta ** 2
      along += (point[axis] - from[first + axis]) * delta
    }
    return squared > 0 ? Math.max(0, Math.min(1, along / squared)) : 1
  }

  /** How far a point is from a move's point at a fraction of it. */
  const distanceAlong = (move: number, fraction: number, point: Point3) => {
    const first = move * 3
    let squared = 0
    for (let axis = 0; axis < 3; axis++) {
      const start = from[first + axis]
      const along = start + (to[first + axis] - start) * fraction
      squared += (along - point[axis]) ** 2
    }
    return Math.sqrt(squared)
  }

  /** Whether a point is beyond `radius` of the box around a move, along any axis. */
  const outside = (move: number, point: Point3, radius: number) => {
    const first = move * 3
    for (let axis = 0; axis < 3; axis++) {
      const a = from[first + axis]
      const b = to[first + axis]
      const value = point[axis]
      if (value < Math.min(a, b) - radius || value > Math.max(a, b) + radius)
        return true
    }
    return false
  }

  const project = (move: MoveIndex, point: Point3) => {
    const fraction = nearestFraction(move, point)
    return { fraction, distance: distanceAlong(move, fraction, point) }
  }

  /** The first checkpoint `before` is false for, as it is for every one after; null for none. */
  const firstCheckpoint = (
    before: (checkpoint: Checkpoint) => boolean
  ): Checkpoint | null => {
    const index = partition(0, checkpoints.length, (checkpoint) =>
      before(checkpoints[checkpoint])
    )
    return index < checkpoints.length ? checkpoints[index] : null
  }

  /** When a move ends. */
  const endOf = (move: number) => timing.start[move] + timing.duration[move]

  return {
    plan,
    duration: planSeconds(timing.total),
    at,
    timeOf: (move, fraction = 0) =>
      planSeconds(
        timing.start[move] + secondsAt(trapezoid(move), fraction * length[move])
      ),
    pointOf,
    pointAt: (time, out) => {
      if (!count) return out ?? [0, 0, 0]
      const { move, fraction } = at(time)
      return pointOf(move, fraction, out)
    },
    speedAt: (time) => {
      if (!count) return 0
      const move = moveAt(time)
      const elapsed = time - timing.start[move]
      if (elapsed < 0 || elapsed > timing.duration[move]) return 0
      return speedAt(trapezoid(move), elapsed)
    },
    firstMoveFrom: (wanted: SourceLine) =>
      moveIndex(partition(0, count, (index) => line[index] < wanted)),
    reportsOwnLine: (move) =>
      (kind[move] === MOVE_KIND.feed || kind[move] === MOVE_KIND.arc) &&
      !routine[move],
    reporting: (reported): MoveRange => {
      const first = partition(0, count, (index) => reportLine[index] < reported)
      const end = partition(
        first,
        count,
        (index) => reportLine[index] <= reported
      )
      return { first: moveIndex(first), end: moveIndex(end) }
    },
    lineAtBytes: (fraction) => {
      ends ??= lineEnds(plan.program.lines)
      const lines = ends
      if (!lines.length) return sourceLine(0)
      const byte = Math.max(0, Math.min(1, fraction)) * lines[lines.length - 1]
      const index = partition(0, lines.length, (end) => lines[end] <= byte)
      return sourceLine(Math.min(index, lines.length - 1) + 1)
    },
    /** The moves of `within` that pass within `radius` of a point, nearest first. */
    near: (point, radius, within, limit) => {
      grid ??= gridOfMoves(from, to, count)
      measured ??= new Uint32Array(count)
      const marks = measured
      // A query's number marks the moves it measured; after the last number they start over.
      if (++query === 0xffffffff) {
        marks.fill(0)
        query = 1
      }
      const found: { move: MoveIndex; distance: number }[] = []
      const first = Math.max(0, within.first)
      const end = Math.min(within.end, count)
      visitNear(grid, point[0], point[1], radius, first, end, (move) => {
        if (marks[move] === query) return
        marks[move] = query
        if (outside(move, point, radius)) return
        const distance = distanceAlong(
          move,
          nearestFraction(move, point),
          point
        )
        if (distance <= radius) found.push({ move: moveIndex(move), distance })
      })
      return found
        .sort((a, b) => a.distance - b.distance || a.move - b.move)
        .slice(0, limit)
        .map(({ move }) => move)
    },
    project,
    nextTouch: (move) => {
      touches ??= touchesFrom(plan)
      const next = move >= 0 && move < count ? touches[move] : -1
      return next < 0 ? -1 : moveIndex(next)
    },
    /** The move under way and every move that starts within `seconds` after `time`. */
    aheadEnd: (time, seconds) => {
      if (!count) return moveIndex(0)
      const { move } = at(time)
      return moveIndex(
        partition(
          move + 1,
          count,
          (index) => timing.start[index] < time + seconds
        )
      )
    },
    checkpointAfter: (move): Checkpoint | null => {
      const found = firstCheckpoint(({ after }) => after < move)
      return found?.after === move ? found : null
    },
    /** The first checkpoint whose move ends at or after `time`. */
    nextCheckpoint: (time): Checkpoint | null =>
      firstCheckpoint(({ after }) => endOf(after) < time),
    shiftAt: (move): Vec3 => {
      const index = partition(
        0,
        shifts.length,
        (shift) => shifts[shift].from <= move
      )
      return index > 0 ? shifts[index - 1].shift : [0, 0, 0]
    },
  }
}
