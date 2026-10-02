import { isTerminalJobPhase } from "@/machine/contract"
import type { MachineState } from "@/machine/contract"
import { moveIndex, planSeconds, sourceLine } from "@/domain/motion/spaces"
import type { MoveRange, Vec3 } from "@/domain/motion/spaces"
import { MOVE_KIND } from "@/domain/motion/types"
import type { MotionPlan, PlanIndex } from "@/domain/motion/types"
import type {
  Estimate,
  Observation,
  Tracker,
  TrackerState,
  TrackStatus,
} from "./types"

/**
 * How fast, at most, a machine goes through its plan, in seconds of it per second: faster than it
 * is timed under a feed override.
 */
const MOST_PACE = 2

/**
 * How far off (mm) a point may be for each second of the plan it lies beyond where the machine
 * can have got since it was last placed (`MOST_PACE`), to count as near: the next point along the
 * path wins over a point as near that the path comes back over later.
 */
const MM_PER_SECOND_AWAY = 5

/**
 * The same for a point behind where it was last placed (`BACK_SECONDS.free`): the machine only
 * goes on through its plan, so a point it went through before wins only when the path ahead comes
 * nowhere near.
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
 * How long (s), at most, a machine is taken to have gone on at the pace its plan is timed at since
 * it was last placed: about as long as between reports. After longer it may as well have waited,
 * such as for a tool change.
 */
const GOING_ON_SECONDS = 0.5

/**
 * How far (s of the plan) before where the machine was last placed it may be placed again: a
 * little, as a reading's noise along a slow move, or the path's corners, may have placed it a
 * little ahead; and how far before the furthest it was placed does not count as behind it, so
 * that reports in a row cannot walk it back along a path it came down, such as a probe's, while
 * it climbs the same path again.
 */
const BACK_SECONDS = { most: 1, free: 0.25 } as const

/**
 * How far along a move, at most, a machine at its end is placed: still on it, made with its tool,
 * rather than at the start of the next, which a tool change may make with another.
 */
const AT_END = 1 - 1e-6

/**
 * How long (s of the plan) feed moves may take and still pass unreported: the firmware takes the
 * line of the feed move under way only when a status report asks for it, about every 250 ms while
 * a job runs.
 */
const UNREPORTED_FEED_SECONDS = 0.5

/**
 * How far off (mm) a move made with another tool than the one the machine holds counts as, when a
 * move in reach is made with that one: the setter and the change position are visited at every
 * tool change, by each tool in turn.
 */
const MM_OTHER_TOOL = 200

/**
 * How far (mm) a report may put the tool off the plan's moves before it is drawn where the machine
 * reported it, such as where a probe touched before the plate's model has it touch; and how near
 * it then comes again (`NEAR_REPORTS`) to be drawn on them, so that a reading about as far off
 * does not switch between both.
 */
const OFF_MOVES_MM = { enter: 1.5, leave: 0.5 } as const

/** Reports in a row near the moves again (`OFF_MOVES_MM`) that put the tool back on them. */
const NEAR_REPORTS = 2

/** The states a machine stands still in during a job, until the user goes on. */
const HELD: ReadonlySet<MachineState> = new Set(["Tool", "Pause", "Hold"])

/** Whether a program line does anything: not blank, nor only comments. */
const executes = (text: string) =>
  text.replace(/\([^)]*\)|;.*$/g, "").trim() !== ""

/**
 * The furthest line a job is known to play: the line it reports, or, once it resumed from a
 * program pause, the first line after the pause that does anything. The reported line moves only
 * with feed moves (G1, G2, G3), so after a pause it stays on the line before it until the next
 * one, while probing, rapids and tool changes run. Null before the job reports progress.
 */
function playedLine(
  { line, resumedLine }: Observation,
  lines: readonly string[]
): number | null {
  if (line === null || resumedLine === null) return line
  let played = resumedLine
  while (played > 0 && played < lines.length && !executes(lines[played - 1]))
    played += 1
  return Math.max(line, Math.min(played, lines.length))
}

/** Each plan's first probe search: the first move it makes with a tool it reports. */
const firstTouches = new WeakMap<MotionPlan, number>()

/**
 * The first move a machine makes with a tool it reports: Run leaves it none until its first tool
 * change measures one, from the plan's first touch on. The plan's length when nothing touches.
 */
function firstTouch(plan: MotionPlan) {
  let touch = firstTouches.get(plan)
  if (touch === undefined) {
    touch = plan.kind.indexOf(MOVE_KIND.probe)
    if (touch < 0) touch = plan.count
    firstTouches.set(plan, touch)
  }
  return touch
}

/**
 * A plan's moving time: its time without the dwells between moves, where the machine stands
 * still and its reports cannot tell how long it has. A machine placed at the end of a move before
 * a dwell is as near the next move's start as the moves' times put it.
 */
type MovingTime = {
  /** Seconds of dwells before each move starts. */
  readonly idle: Float64Array
  /** When each move starts, in moving time. */
  readonly start: Float64Array
}

const movingTimes = new WeakMap<MotionPlan, MovingTime>()

function movingTimeOf(plan: MotionPlan): MovingTime {
  const cached = movingTimes.get(plan)
  if (cached) return cached
  const { start, duration } = plan.timing
  const idle = new Float64Array(plan.count)
  const moving = new Float64Array(plan.count)
  for (let move = 0; move < plan.count; move++) {
    const ended = move > 0 ? start[move - 1] + duration[move - 1] : 0
    idle[move] =
      (move > 0 ? idle[move - 1] : 0) + Math.max(0, start[move] - ended)
    moving[move] = start[move] - idle[move]
  }
  const made = { idle, start: moving }
  movingTimes.set(plan, made)
  return made
}

/** A plan time in moving time: in a dwell, the end of the move before it. */
function movingAt(index: PlanIndex, time: number) {
  const { plan } = index
  if (!plan.count) return 0
  const { move } = index.at(planSeconds(time))
  const ended = plan.timing.start[move] + plan.timing.duration[move]
  return Math.min(time, ended) - movingTimeOf(plan).idle[move]
}

/** The move under way at a moving time, or at the end of one, the next. */
function moveAtMoving({ plan }: PlanIndex, time: number) {
  const { start } = movingTimeOf(plan)
  let low = 0
  let high = plan.count
  while (low < high) {
    const middle = (low + high) >>> 1
    if (start[middle] <= time) low = middle + 1
    else high = middle
  }
  return Math.max(0, low - 1)
}

/** When the machine has made the plan's first `count` moves, before any dwell after them. */
function timeAfterMoves({ plan }: PlanIndex, count: number) {
  if (count <= 0 || !plan.count) return 0
  const last = Math.min(count, plan.count) - 1
  return plan.timing.start[last] + plan.timing.duration[last]
}

/**
 * The moves a machine reporting `line` may be making: from the line's own, those that report what
 * the first does, and on into later lines' for as long as their feed moves may have passed
 * unreported (`UNREPORTED_FEED_SECONDS`).
 */
function movesReporting(index: PlanIndex, line: number): MoveRange {
  const { plan } = index
  const first = index.firstMoveFrom(sourceLine(line))
  if (first === plan.count) return { first, end: first }
  let end: number = index.reporting(sourceLine(plan.reportLine[first])).end
  let unreported = 0
  while (end < plan.count && unreported <= UNREPORTED_FEED_SECONDS) {
    if (index.reportsOwnLine(moveIndex(end)))
      unreported += plan.timing.duration[end]
    end++
  }
  return { first, end: moveIndex(end) }
}

/** What a machine report says about where it is in a plan. */
type MachineReport = {
  /** The line it reports. */
  readonly line: number
  /** Where it is, in plan coordinates, however they were read. */
  readonly positions: readonly Vec3[]
  /**
   * The tool in its spindle; -1 for none, as from Run until a tool is measured, and from
   * confirming a manual tool change until the new tool is; null when unknown.
   */
  readonly tool: number | null
  /** The tool a manual tool change is for; null when unknown. */
  readonly requestedTool: number | null
}

/** Where a machine was last placed in a plan. */
type LastPlacement = {
  /** When, in plan seconds. */
  readonly time: number
  /** The furthest it was placed since it was placed anew, in plan seconds. */
  readonly furthest: number
  /** How long ago, in seconds. */
  readonly since: number
}

/** When a report places the machine, and whether anew, rather than on from where it was. */
type Placement = { readonly time: number; readonly anew: boolean }

/**
 * When, in a plan, a machine making `report` is: the point of the moves in reach nearest to where
 * it is, made with the tool it holds, and to where it can have got since it was last placed
 * (`last`; `MM_PER_SECOND_AWAY`, and far more behind it), so that a path that passes the same
 * place twice is followed along; where the moves before them end when there are none. The machine
 * reports the line of the feed move under way or last (`MotionPlan.reportLine`), so its rapids,
 * probing and routines after it leave the report behind: the moves in reach are those that may
 * report the line (`movesReporting`), from a little before where it was last placed on
 * (`BACK_SECONDS`), unless the line puts it before there. Holding no tool, it makes the moves
 * before its first tool is measured (`firstTouch`), or a manual tool change measures the tool it
 * is for, which the change's moves are made with. How far behind or beyond it can have got counts
 * in moving time (`MovingTime`), which a dwell it stood still through does not add to; between
 * them the plan's time chooses, so that a machine standing still before a dwell stays before it.
 */
function timeAtPosition(
  index: PlanIndex,
  { line, positions, tool, requestedTool }: MachineReport,
  last: LastPlacement | null
): Placement {
  const { plan } = index
  const reach = movesReporting(index, line)
  const { end } = reach
  const start = timeAfterMoves(index, reach.first)
  if (reach.first === end) return { time: start, anew: true }
  if (!positions.length)
    return { time: Math.max(start, last?.time ?? start), anew: !last }
  const { idle } = movingTimeOf(plan)
  const from = last
    ? moveAtMoving(index, movingAt(index, last.time) - BACK_SECONDS.most)
    : end
  // Moves in reach that all lie before where it was last placed correct that: it is placed anew.
  const placed =
    last && from < end
      ? {
          ...last,
          moving: movingAt(index, last.time),
          furthest: movingAt(index, Math.max(last.time, last.furthest)),
        }
      : null
  const first = placed ? Math.max(reach.first, from) : reach.first
  const touch = firstTouch(plan)
  const madeWithTool = (move: number) =>
    tool === -1
      ? move < touch || plan.tool[move] === requestedTool
      : plan.tool[move] === tool
  let known = false
  for (let move = first; move < end && !known; move++)
    known = madeWithTool(move)
  /** How far off (mm) a point `time` into the plan counts as, `moving` into its moving time. */
  const away = (time: number, moving: number) => {
    if (!placed) return (time - start) * MM_PER_SECOND_UNSURE
    const behind = placed.furthest - BACK_SECONDS.free
    const beyond = placed.moving + placed.since * MOST_PACE
    if (moving < behind) return (behind - moving) * MM_PER_SECOND_BACK
    if (moving > beyond) return (moving - beyond) * MM_PER_SECOND_AWAY
    const going = placed.time + Math.min(placed.since, GOING_ON_SECONDS)
    return Math.abs(time - going) * MM_PER_SECOND_UNSURE
  }
  let best = { cost: Infinity, time: start }
  for (let move = first; move < end; move++) {
    for (const position of positions) {
      const { fraction, distance } = index.project(moveIndex(move), position)
      const time = index.timeOf(moveIndex(move), Math.min(fraction, AT_END))
      const cost =
        distance +
        (known && !madeWithTool(move) ? MM_OTHER_TOOL : 0) +
        away(time, time - idle[move])
      if (cost < best.cost) best = { cost, time }
    }
  }
  return { time: best.time, anew: !placed }
}

const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/**
 * How fast the plan goes on while the job runs, in plan seconds per second: at the feed override,
 * and not at all while the machine waits for the user, holds or the job has ended.
 */
function rateOf({ wait, state, phase, feed }: Observation) {
  if (wait || HELD.has(state) || isTerminalJobPhase(phase)) return 0
  return (feed.override ?? 100) / 100
}

/**
 * Follows a job through its plan as each report places it, alone: at the point of the moves its
 * line leaves in reach nearest to where the machine reports it (by its machine position and by its
 * work position, whichever is nearer), made with the tool it holds and near where its last report
 * placed it (`timeAtPosition`). Off the moves by more than a reading allows, the tool is drawn
 * where the machine reported it, until reports in a row put it near them again. Its beam holds one
 * hypothesis: the furthest it placed the machine since it placed it anew.
 */
export const greedyTracker: Tracker = {
  name: "greedy",
  start: (jobId, index): TrackerState => ({
    jobId,
    planKey: index.plan.key,
    beam: [],
    last: null,
    estimate: null,
    misses: 0,
    offPlan: { on: false, near: 0 },
    bias: { machine: [0, 0, 0], work: [0, 0, 0], samples: 0 },
    scale: { feed: 1, rapid: 1 },
  }),
  observe: (index, state, observation) => {
    const observed = { ...state, last: observation }
    const line = playedLine(observation, index.plan.program.lines)
    if (line === null) return observed
    const previous = state.estimate
    const positions: Vec3[] = []
    if (observation.machineTip) positions.push(observation.machineTip)
    if (observation.workTip) positions.push(observation.workTip)
    const furthest = Math.max(line, previous?.line ?? 0)
    const reached = state.beam.at(0)
    const placement = timeAtPosition(
      index,
      {
        line: furthest,
        positions,
        tool: observation.tool.active,
        requestedTool: observation.tool.target,
      },
      previous && {
        time: previous.time,
        furthest: reached?.time ?? previous.time,
        since: Math.max(0, (observation.at - previous.at) / 1000),
      }
    )
    const { time } = placement
    // Off the moves by more than either reading allows, the tool is drawn where the report has it,
    // until reports in a row put it near them again.
    const onMoves = index.plan.count ? index.pointAt(planSeconds(time)) : null
    const reported = positions.at(0) ?? null
    const away =
      onMoves && reported
        ? Math.min(...positions.map((at) => distance(at, onMoves)))
        : 0
    const { offPlan } = state
    const near = offPlan.on && away <= OFF_MOVES_MM.leave ? offPlan.near + 1 : 0
    const off = offPlan.on ? near < NEAR_REPORTS : away > OFF_MOVES_MM.enter
    const tip = off ? reported : null
    const rate = rateOf(observation)
    let status: TrackStatus = "locked"
    if (tip) status = "off-plan"
    else if (observation.wait) status = "waiting"
    const { move, fraction } = index.at(planSeconds(time))
    const estimate: Estimate = {
      at: observation.at,
      time: planSeconds(time),
      move,
      fraction,
      line: sourceLine(furthest),
      rate,
      status,
      spread: 0,
      tip,
      residual: reported ? away : NaN,
    }
    const ahead =
      reached && !placement.anew && reached.time > time
        ? reached
        : { move, fraction, time: estimate.time, score: 0 }
    return {
      ...observed,
      beam: [ahead],
      estimate,
      offPlan: { on: tip !== null, near: tip ? near : 0 },
    }
  },
}
