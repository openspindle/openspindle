import { moveIndex, planSeconds, sourceLine } from "@/domain/motion/spaces"
import type { MoveIndex, PlanSeconds, Vec3 } from "@/domain/motion/spaces"
import { MOVE_KIND } from "@/domain/motion/types"
import type { MotionPlan, PlanIndex } from "@/domain/motion/types"
import { stepForMove } from "@/features/job/preview-timeline"
import type {
  PreviewStep,
  PreviewTimeline,
} from "@/features/job/preview-timeline"
import type { PlaybackFrame } from "./frame"

/** How far ahead of the tool the path ahead reaches: the moves that start within this many seconds. */
const AHEAD_SECONDS = 4

/** What a frame at a time of the plan is of, beside the plan and the time. */
export type FrameOptions = {
  readonly source: Exclude<PlaybackFrame["source"], "preview">
  readonly status: PlaybackFrame["status"]
  /** The timeline whose step the frame shows. */
  readonly timeline: Pick<PreviewTimeline, "steps">
  /** How many of the plan's first moves the implicit tool makes (`MoveTools.implicitMoves`). */
  readonly implicitMoves: number
  /** Where the tool is drawn off the moves, as the machine reported it; null or absent on them. */
  readonly tip?: Vec3 | null
  /**
   * The path ahead ends no earlier than this: where it ended in the frame before while following
   * a job, so that it only grows as the tool goes on.
   */
  readonly aheadFloor?: MoveIndex
  /** The line on show is no earlier than this: the furthest line the machine reported. */
  readonly line?: number
}

/**
 * The tool on the plate making a move: its own, but the implicit tool (null) for the moves before
 * the program first changes tools (`MoveTools.implicitMoves`).
 */
export const toolOf = (
  plan: MotionPlan,
  move: number,
  implicitMoves: number
) => (move < implicitMoves ? null : plan.tool[move])

/**
 * How many of a plan's moves a timeline step shows made: the moves through its line, or on a
 * probe grid's line, through its sample's touch, so the probe shows where it probes.
 */
function revealedAt(index: PlanIndex, { line, probePoint }: PreviewStep) {
  const { plan } = index
  const through: number = index.firstMoveFrom(sourceLine(line + 1))
  if (probePoint === undefined) return through
  let end: number | null = null
  for (
    let move: number = index.firstMoveFrom(sourceLine(line));
    move < plan.count && plan.line[move] === line;
    move++
  ) {
    // Moves before the grid's own, such as changing to the probe, come with its first sample.
    const point = Math.max(0, plan.probePoint[move])
    if (point > probePoint) break
    if (point === probePoint && plan.kind[move] === MOVE_KIND.probe)
      end = move + 1
  }
  return end ?? through
}

/** How many moves step `step` of a timeline shows made; none at its start. */
const stepRevealed = (
  index: PlanIndex,
  timeline: Pick<PreviewTimeline, "steps">,
  step: number
) => (step > 0 ? revealedAt(index, timeline.steps[step - 1]) : 0)

/** When a plan has made its first `count` moves, before any dwell after them. */
function timeAfterMoves({ plan }: PlanIndex, count: number) {
  if (count <= 0 || !plan.count) return planSeconds(0)
  const last = Math.min(count, plan.count) - 1
  return planSeconds(plan.timing.start[last] + plan.timing.duration[last])
}

/** When playing on from a timeline's step starts: once the moves it shows are made. */
export const stepTime = (
  index: PlanIndex,
  timeline: Pick<PreviewTimeline, "steps">,
  step: number
): PlanSeconds => timeAfterMoves(index, stepRevealed(index, timeline, step))

/**
 * The frame of a plan at `time`, while playback simulates it or a job is followed through it: the
 * moves before the one under way made, the tool along that one, or where the machine reported it
 * off the moves; the moves it makes within the next few seconds ahead of it, monotone while
 * following (`aheadFloor`); and the next touch from the move under way. Null for a plan of no
 * moves.
 */
export function frameAt(
  index: PlanIndex,
  time: number,
  options: FrameOptions
): PlaybackFrame | null {
  const { plan } = index
  if (!plan.count) return null
  const at = planSeconds(Math.max(0, Math.min(index.duration, time)))
  const { move, fraction } = index.at(at)
  const line = plan.line[move]
  const probePoint = plan.probePoint[move]
  const tip = options.tip ?? null
  return {
    index,
    source: options.source,
    time: at,
    move,
    fraction,
    revealed: move,
    tip: tip ?? index.pointOf(move, fraction),
    offPlan: tip !== null,
    tool: toolOf(plan, move, options.implicitMoves),
    line: sourceLine(Math.max(options.line ?? 0, line)),
    step: stepForMove(options.timeline, {
      line,
      probePoint: probePoint < 0 ? undefined : probePoint,
    }),
    aheadEnd: moveIndex(
      Math.max(options.aheadFloor ?? 0, index.aheadEnd(at, AHEAD_SECONDS))
    ),
    nextTouch: index.nextTouch(move),
    status: options.status,
  }
}

/**
 * The frame of a plan at a timeline's step, as the preview shows it: the moves through the step
 * made and the tool at the end of the last, with no moves ahead. Null where the step shows every
 * move made, as the whole program shows with no tool.
 */
export function stepFrame(
  index: PlanIndex,
  timeline: Pick<PreviewTimeline, "steps">,
  step: number,
  implicitMoves: number
): PlaybackFrame | null {
  const { plan } = index
  const revealed = stepRevealed(index, timeline, step)
  if (revealed >= plan.count) return null
  const move = moveIndex(Math.max(0, revealed - 1))
  const fraction = revealed > 0 ? 1 : 0
  return {
    index,
    source: "preview",
    time: index.timeOf(move, fraction),
    move,
    fraction,
    revealed: moveIndex(revealed),
    tip: index.pointOf(move, fraction),
    offPlan: false,
    tool: toolOf(plan, move, implicitMoves),
    line: sourceLine(step > 0 ? timeline.steps[step - 1].line : 0),
    step,
    aheadEnd: move,
    nextTouch: index.nextTouch(moveIndex(revealed)),
    status: "simulated",
  }
}

/** Whether two frames show the same: a frame set again unchanged draws nothing new. */
export function sameFrame(a: PlaybackFrame | null, b: PlaybackFrame | null) {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.index === b.index &&
    a.source === b.source &&
    a.time === b.time &&
    a.revealed === b.revealed &&
    a.tip[0] === b.tip[0] &&
    a.tip[1] === b.tip[1] &&
    a.tip[2] === b.tip[2] &&
    a.offPlan === b.offPlan &&
    a.tool === b.tool &&
    a.line === b.line &&
    a.step === b.step &&
    a.aheadEnd === b.aheadEnd &&
    a.nextTouch === b.nextTouch &&
    a.status === b.status
  )
}
