import { MAX_PROGRAM_LINES } from "@/domain/nc/gcode"
import type { GCodeProgram, GCodeSegment } from "@/domain/nc/gcode"
import { readNcBlock } from "@/machine/contract"
import type { MachineLimits, MotionModel, NcWordLike } from "./limits"
import { moveIndex } from "./spaces"
import { timePlan } from "./timing"
import { MOVE_FRAME, MOVE_KIND, UNKNOWN_TOOL } from "./types"
import type { MotionPlan, MoveKind } from "./types"

/** A move the program makes itself at its feed: one its firmware reports the line of (`P:`). */
const programFeed = (
  segment: GCodeSegment | undefined
): segment is GCodeSegment =>
  !!segment && !segment.rapid && !segment.routine && !segment.probing

/**
 * What kind of move a program's move is: a probe's search, a rapid, an arc's chord (a feed move
 * that shares its line with the next or the one before), else a feed move.
 */
function kindOf(segments: readonly GCodeSegment[], index: number): MoveKind {
  const segment = segments[index]
  if (segment.probing) return MOVE_KIND.probe
  if (segment.rapid) return MOVE_KIND.rapid
  if (!programFeed(segment)) return MOVE_KIND.feed
  const shares = (other: GCodeSegment | undefined) =>
    programFeed(other) && other.line === segment.line
  return shares(segments[index - 1]) || shares(segments[index + 1])
    ? MOVE_KIND.arc
    : MOVE_KIND.feed
}

/** Whether a block ends the program, as M2 and M30 end its parse. */
const endsProgram = (words: readonly NcWordLike[]) =>
  words.some(
    ({ letter, value }) => letter === "M" && (value === 2 || value === 30)
  )

/**
 * The moves a machine makes for a program read with its firmware (`GCodeFirmware`), with what it
 * reports during each and when each runs by the machine's limits. Routines' moves are placed by
 * machine position, the program's own by work position. The line reported is the last feed move's
 * (`P:`); the tool reported is the one each move is made with, and the tool asked for unknown.
 * The machine stops where `model` has a block stop it, and before and after each probe search.
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
  const reportTarget = new Int32Array(count).fill(UNKNOWN_TOOL)
  let reported = 0
  segments.forEach((segment, index) => {
    const at = index * 3
    from.set(segment.start, at)
    to.set(segment.end, at)
    length[index] = Math.hypot(
      to[at] - from[at],
      to[at + 1] - from[at + 1],
      to[at + 2] - from[at + 2]
    )
    kind[index] = kindOf(segments, index)
    routine[index] = segment.routine ? 1 : 0
    frame[index] = segment.routine ? MOVE_FRAME.machine : MOVE_FRAME.work
    overridable[index] = segment.probing ? 0 : 1
    // A probe search starts and ends with the queue empty.
    if (segment.probing) {
      drainBefore[index] = 1
      if (index + 1 < count) drainBefore[index + 1] = 1
    }
    line[index] = segment.line
    rate[index] = segment.feed
    probePoint[index] = segment.probePoint ?? -1
    tool[index] = segment.tool
    if (programFeed(segment)) reported = segment.line
    reportLine[index] = reported
  })

  // Each block that stops the machine does so before the first move at or after its line.
  let dwellAfterLast = 0
  let spindleOn = false
  let next = 0
  const lines = Math.min(program.lines.length, MAX_PROGRAM_LINES)
  for (let index = 0; index < lines; index++) {
    const block = readNcBlock(program.lines[index])
    if (block.problem || !block.words.length || block.message !== null) continue
    const stop = model.stop(block.words, spindleOn, limits)
    if (stop) {
      while (next < count && line[next] < index + 1) next++
      if (next < count) {
        if (stop.drain) drainBefore[next] = 1
        dwellBefore[next] += stop.dwell
      } else dwellAfterLast += stop.dwell
      if (stop.spindle !== null) spindleOn = stop.spindle
    }
    if (endsProgram(block.words)) break
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
    reportTool: tool,
    reportTarget,
    timing,
    checkpoints: [],
    shifts: [{ from: moveIndex(0), shift: [0, 0, 0] }],
    workZFrom: moveIndex(0),
    limits,
  }
}
