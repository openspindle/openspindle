import { MAX_PROGRAM_LINES } from "@/domain/nc/gcode"
import type { GCodeProgram, GCodeSegment } from "@/domain/nc/gcode"
import { readNcBlock } from "@/machine/contract"
import type {
  MachineLimits,
  MotionModel,
  MotionStop,
  NcWordLike,
} from "./limits"
import { moveIndex, sourceLine } from "./spaces"
import type { MoveIndex, Vec3 } from "./spaces"
import { timePlan } from "./timing"
import { MOVE_FRAME, MOVE_KIND, UNKNOWN_TOOL } from "./types"
import type { Checkpoint, MotionPlan, MoveKind } from "./types"

/** A block that stops the machine between moves (`MotionModel.stop`), at its line. */
type LineStop = { readonly line: number; readonly stop: MotionStop }

/** Whether a block ends the program, as M2 and M30 end its parse. */
const endsProgram = (words: readonly NcWordLike[]) =>
  words.some(
    ({ letter, value }) => letter === "M" && (value === 2 || value === 30)
  )

/**
 * A line that only moves, which stops no machine: at most G0 to G3, then axis, arc and feed
 * words. The stops are not looked for in lines like it, most of a program's.
 */
const MOVES_ONLY =
  /^[ \t]*(?:G0*[0-3](?![\d.])[ \t]*)?(?:[XYZIJKRF][ \t]*[-+]?(?:\d+\.?\d*|\.\d+)[ \t]*)+$/i

/**
 * The blocks of a program that stop its machine between moves, in line order, as far as the
 * program runs: with the spindle each leaves on or off, which the next one's dwell depends on.
 */
function stopsOf(
  program: GCodeProgram,
  model: MotionModel,
  limits: MachineLimits
): LineStop[] {
  const stops: LineStop[] = []
  let spindleOn = false
  const lines = Math.min(program.lines.length, MAX_PROGRAM_LINES)
  for (let index = 0; index < lines; index++) {
    const text = program.lines[index]
    if (MOVES_ONLY.test(text)) continue
    const block = readNcBlock(text)
    if (block.problem || !block.words.length || block.message !== null) continue
    const stop = model.stop(block.words, spindleOn, limits)
    if (stop) {
      stops.push({ line: index + 1, stop })
      if (stop.spindle !== null) spindleOn = stop.spindle
    }
    if (endsProgram(block.words)) break
  }
  return stops
}

/** What kind of move a program's move is: a probe's search, a rapid, an arc's chord or a feed move. */
const kindOf = (segment: GCodeSegment): MoveKind =>
  segment.probing
    ? MOVE_KIND.probe
    : segment.rapid
      ? MOVE_KIND.rapid
      : segment.arc
        ? MOVE_KIND.arc
        : MOVE_KIND.feed

/** Whether the firmware reports a move's own line (`P:`): a feed move of the program's own. */
const reportsOwnLine = (segment: GCodeSegment) =>
  !segment.rapid && !segment.probing && !segment.routine

/** Whether two moves belong to one run of a routine: its block's, one after the other. */
const sameRoutine = (segment: GCodeSegment, other: GCodeSegment | undefined) =>
  !!segment.routine && !!other?.routine && other.line === segment.line

/**
 * Where the work offset changes along a program's moves, from the first on: the program's
 * (`GCodeProgram.offsets`), but a routine's move made in work coordinates it set itself is made in
 * its own (`GCodeSegment.workOffset`). A work move's point less its shift is where it is in the
 * machine's work coordinates.
 */
function shiftsOf({ offsets, segments }: GCodeProgram): MotionPlan["shifts"] {
  const shifts: { from: MoveIndex; shift: Vec3 }[] = []
  let next = 0
  let program: Vec3 = [0, 0, 0]
  for (let index = 0; index < segments.length; index++) {
    while (next < offsets.length && offsets[next].segment <= index)
      program = [...offsets[next++].offset]
    const shift = segments[index].workOffset ?? program
    const last = shifts.at(-1)
    if (last?.shift.every((value, axis) => value === shift[axis])) continue
    shifts.push({ from: moveIndex(index), shift: [...shift] })
  }
  return shifts.length ? shifts : [{ from: moveIndex(0), shift: [0, 0, 0] }]
}

/**
 * The first move after the program sets work Z, or a routine of its sets it and moves in it
 * (`GCodeSegment.workOffset`); the first move when neither does.
 */
function workZFromOf({ offsets, segments }: GCodeProgram): MoveIndex {
  const set = offsets.find(({ setsWorkZ }) => setsWorkZ)?.segment
  const moved = segments.findIndex((segment) => !!segment.workOffset)
  const first = [set, moved >= 0 ? moved : undefined].filter(
    (at): at is number => at !== undefined
  )
  return moveIndex(first.length ? Math.min(...first) : 0)
}

/**
 * The moves a machine makes for a program read with its firmware (`GCodeFirmware`), with what it
 * reports during each and when each runs by the machine's limits.
 *
 * - Routines' moves and a G53 block's own are placed by machine position, the program's others
 *   by work position, less the program's work offset at the move (`shifts`); a routine's move
 *   made in work coordinates it set itself (`GCodeSegment.workOffset`) by work position too, less
 *   that offset. Work Z is the machine's from the first move after the program first sets it, or
 *   a routine moves in work Z it set (`workZFrom`).
 * - The line the firmware reports (`P:`) is the last feed move's of the program's own, G53's
 *   included, or a pause's after it (`reportLine`). The tools it reports come from the firmware's
 *   status (`GCodeSegment.statusTool`, `statusTarget`).
 * - The machine waits for the user after the move a tool change waits at, and at each pause
 *   (`checkpoints`).
 * - Moves at a firmware's default rate (`GCodeSegment.defaultRate`) run at the machine's, by its
 *   limits, in the same proportion; the model's defaults are the rates the parse used. Probe
 *   searches run at their feed whatever the override.
 * - The machine stops where `model` has a block stop it, before and after each probe search and
 *   around each routine.
 */
export function planMotion(
  key: string,
  program: GCodeProgram,
  model: MotionModel,
  limits: MachineLimits
): MotionPlan {
  const { segments } = program
  const count = segments.length
  const from = new Float32Array(count * 3)
  const to = new Float32Array(count * 3)
  const length = new Float32Array(count)
  const kind = new Uint8Array(count)
  const routine = new Uint8Array(count)
  const frame = new Uint8Array(count)
  const overridable = new Uint8Array(count)
  const drainBefore = new Uint8Array(count)
  const dwellBefore = new Float32Array(count)
  const line = new Uint32Array(count)
  const rate = new Float32Array(count)
  const probePoint = new Int32Array(count)
  const tool = new Int32Array(count)
  const reportLine = new Uint32Array(count)
  const reportTool = new Int32Array(count)
  const reportTarget = new Int32Array(count)
  const checkpoints: Checkpoint[] = []
  const stops = stopsOf(program, model, limits)
  let nextStop = 0
  let reported = 0
  let dwellAfterLast = 0

  /** A pause's checkpoint after the move before it, and its line, which the firmware then reports. */
  const pause = (stopLine: number, before: number) => {
    if (before >= 0)
      checkpoints.push({
        after: moveIndex(before),
        kind: "pause",
        line: sourceLine(stopLine),
        tool: null,
      })
    reported = stopLine
  }

  for (let index = 0; index < count; index++) {
    const segment = segments[index]
    // Each block that stops the machine does so before the first move at or after its line.
    while (nextStop < stops.length && stops[nextStop].line <= segment.line) {
      const { line: stopLine, stop } = stops[nextStop++]
      if (stop.drain) drainBefore[index] = 1
      dwellBefore[index] += stop.dwell
      if (stop.wait === "pause") pause(stopLine, index - 1)
    }
    const at = index * 3
    const { start, end } = segment
    let squared = 0
    for (let axis = 0; axis < 3; axis++) {
      from[at + axis] = start[axis]
      to[at + axis] = end[axis]
      squared += (to[at + axis] - from[at + axis]) ** 2
    }
    length[index] = Math.sqrt(squared)
    kind[index] = kindOf(segment)
    routine[index] = segment.routine ? 1 : 0
    frame[index] =
      (segment.routine || segment.machine) && !segment.workOffset
        ? MOVE_FRAME.machine
        : MOVE_FRAME.work
    overridable[index] = segment.probing ? 0 : 1
    line[index] = segment.line
    const { defaultRate } = segment
    rate[index] = defaultRate
      ? (limits[defaultRate] * segment.feed) / model.defaults[defaultRate]
      : segment.feed
    probePoint[index] = segment.probePoint ?? -1
    tool[index] = segment.tool
    reportTool[index] = segment.statusTool ?? segment.tool
    reportTarget[index] = segment.statusTarget ?? UNKNOWN_TOOL
    // A probe search starts and ends with the queue empty, as a routine does.
    const previous = index > 0 ? segments[index - 1] : undefined
    if (
      segment.probing ||
      previous?.probing ||
      (segment.routine && !sameRoutine(segment, previous)) ||
      (previous?.routine && !sameRoutine(previous, segment))
    )
      drainBefore[index] = 1
    if (reportsOwnLine(segment)) reported = segment.line
    reportLine[index] = reported
    if (segment.wait === "tool")
      checkpoints.push({
        after: moveIndex(index),
        kind: "tool-wait",
        line: sourceLine(segment.line),
        tool: segment.statusTarget ?? null,
      })
  }
  // Blocks after the last move stop the machine after it.
  for (const { line: stopLine, stop } of stops.slice(nextStop)) {
    dwellAfterLast += stop.dwell
    if (stop.wait === "pause") pause(stopLine, count - 1)
  }

  const timing = timePlan(
    {
      count,
      from,
      to,
      kind,
      line,
      rate,
      overridable,
      drainBefore,
      dwellBefore,
      dwellAfterLast,
    },
    limits
  )
  return {
    key,
    program,
    count,
    from,
    to,
    length,
    kind,
    routine,
    frame,
    overridable,
    drainBefore,
    line,
    probePoint,
    tool,
    reportLine,
    reportTool,
    reportTarget,
    timing,
    checkpoints,
    shifts: shiftsOf(program),
    workZFrom: workZFromOf(program),
    limits,
  }
}
