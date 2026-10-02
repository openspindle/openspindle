/*
 * The hidden Markov model tracker: where a job's machine is in its plan, as map matching finds
 * where a vehicle is on its roads (Newson & Krumm). Each report is explained by a few places in
 * the plan at once, a beam of hypotheses each at a move, a fraction along it and a plan time. A
 * report scores how well each place explains it (emission: the reported tip, line, tools, state,
 * feed and touches), and how likely the machine went there from each place before (transition:
 * plan time as far ahead as the wall time between reports at the plan's pace). The best path
 * into each place is kept (Viterbi), and the best place is the estimate.
 */
import { moveIndex, planSeconds, sourceLine } from "@/domain/motion/spaces"
import type { MoveIndex, Vec3 } from "@/domain/motion/spaces"
import { MOVE_FRAME, MOVE_KIND, UNKNOWN_TOOL } from "@/domain/motion/types"
import type { Checkpoint, MotionPlan, PlanIndex } from "@/domain/motion/types"
import type { JobPhase, MachineState } from "@/machine/contract"
import { isProbeSlot } from "@/domain/tools/tool-table"
import {
  NO_BIAS,
  comparesZ,
  contactOffset,
  register,
  reportedTip,
} from "./registration"
import type { Registration } from "./registration"
import type {
  Estimate,
  Hypothesis,
  Observation,
  TouchObservation,
  TrackStatus,
  Tracker,
  TrackerState,
} from "./types"

/** How many hypotheses the beam keeps. */
const BEAM = 16

/** Hypotheses nearer in plan time than this (s) that report the same are one. */
const SAME_TIME = 0.05

/** How many places finding the machine anew considers, at most. */
const GLOBAL_CANDIDATES = 256

/** How many moves near a reported tip each frame offers as places, at most. */
const NEAR_LIMIT = 64

/** How far (mm) a reported tip may be from a move placed by its frame to be projected onto it. */
const NEAR_RADIUS = { work: 4, machine: 15 } as const

/**
 * How far (mm) reported tips spread about where the plan has the tool: by work position along
 * feed moves and along rapids, along a probe's search by either position, and by machine
 * position, whose Z spreads more while a new tool is measured.
 */
const SIGMA = {
  feed: 0.25,
  rapid: 0.4,
  probe: { work: 1, machine: 3 },
  machine: 3,
  measuring: 15,
} as const

/** Beyond this many spreads (`SIGMA`) a tip's distance counts linearly (Huber), not squared. */
const HUBER = 3

/** How far (mm) past its planned end a probe's search may go before it touches. */
const SEARCH_OVERRUN = 20

/**
 * How badly (log-likelihood) a reported line fits a place: a feed move reporting another line
 * than its own; one at its very start or end reporting its neighbour's, which the move whose own
 * line it is fits better; a line past what the machine can have reported by there; a line that
 * changed where none could; a line past what the machine has read.
 */
const LINE = {
  other: -8,
  neighbour: -1,
  beyond: -10,
  changed: -6,
  unread: -4,
} as const

/** How badly the tool in the spindle, and the tool a change is for, fit a place's other ones. */
const TOOL = { active: -6, target: -3 } as const

/**
 * How badly a state fits a place: waiting where the plan does not wait; idle away from a dwell or
 * where the queue empties; running with a feed in a dwell.
 */
const STATE = { waiting: -12, idle: -3, running: -2 } as const

/**
 * The feed the machine reports (`F:`) on a move's middle (from `FEED.from` to `FEED.to` of it)
 * fits the move's within `FEED.share` of it or `FEED.least` mm/min; else `FEED.other`.
 */
const FEED = {
  other: -2.5,
  share: 0.03,
  least: 5,
  from: 0.05,
  to: 0.95,
} as const

/**
 * A reported contact fits a place at or after the end of the probe's search that made it: the
 * last that ended, of its kind, ending within `TOUCH.reach` mm of it in X and Y; else
 * `TOUCH.other`.
 */
const TOUCH = { other: -6, reach: 5 } as const

/** A report whose best place explains it worse than this misses. */
const MISS = -25

/** After this many misses in a row the machine is lost, and found anew. */
const LOST_AFTER = 3

/** After this long (s) between reports the machine is found anew. */
const GAP_SECONDS = 10

/** How far (plan s) a place may be behind the one before it, as readings' noise puts it. */
const BACK_SECONDS = 0.1

/** How far plan time may stray from its expected pace (β): base, per plan s and per wall s. */
const PACE_SPREAD = { base: 0.12, plan: 0.1, wall: 0.05 } as const

/** Of the free way slower than expected, the small share that still counts, to break ties. */
const SLOWER_TIE = 0.01

/** Off the plan (mm) to draw the tool where reported; back near it in reports in a row. */
const OFF_PLAN = { enter: 1.5, leave: 0.5, reports: 2 } as const

/**
 * The estimate is ambiguous while likely places (posterior ≥ `counted`) are more than `spread`
 * plan s apart and the best is less likely than `posterior`.
 */
const AMBIGUOUS = { spread: 2, posterior: 0.8, counted: 0.1 } as const

/** Consistent reports in a row, since finding the machine, to be sure of where it is. */
const SETTLED = 2

/** Learning each kind of move's pace: share per report, range, and wall time between reports. */
const SCALE = { weight: 0.1, least: 0.5, most: 2, from: 0.2, to: 3 } as const

/** How much of its length a move must go in X and Y for X and Y alone to place a tip along it. */
const FLAT_LEAST = 0.1

/** A place this near a move's end (of its length) is at the end. */
const AT_END = 1e-6

/** The tool the firmware reports while it measures a new tool on its sensor. */
const MEASURING = -1

/** States in which the machine waits: for a tool, a resume, or after a feed hold. */
const WAITING: ReadonlySet<MachineState> = new Set(["Tool", "Pause", "Hold"])

/** States in which the machine is not moving along its plan. */
const STOPPED: ReadonlySet<MachineState> = new Set([
  "Tool",
  "Pause",
  "Hold",
  "Alarm",
  "Sleep",
])

/** States in which it may stand still a while longer than the plan has it, at no cost. */
const SLOWER_FREE: ReadonlySet<MachineState> = new Set([
  "Tool",
  "Pause",
  "Hold",
  "Idle",
])

/** Phases before the machine plays the program, and after it played all of it. */
const BEFORE: ReadonlySet<JobPhase> = new Set([
  "preparing",
  "uploading",
  "verifying",
  "starting",
])
const PLAYED: ReadonlySet<JobPhase> = new Set([
  "finishing",
  "cleaning",
  "completed",
])

/** The HMM tracker's state, with what it keeps beside any tracker's. */
type HmmState = TrackerState & {
  /** Consistent reports in a row since the machine was found (anew). */
  readonly settled: number
  /** The last contact reported, and how far it is from where its search ends in the plan. */
  readonly touch: TouchOffset | null
}

/** A reported contact, and how far (mm) it is from where the plan's search ends. */
export type TouchOffset = {
  readonly kind: TouchObservation["kind"]
  readonly search: MoveIndex
  readonly offset: Vec3
}

/** A place in the plan: a move, how far along it, and the plan time, later in a dwell after it. */
type Place = {
  readonly move: MoveIndex
  readonly fraction: number
  readonly time: number
}

/** What the tracker reads off a plan beside its index, built once per plan. */
type PlanMarks = {
  /** Probes' searches, in order. */
  readonly searches: Int32Array
  /** Moves the queue empties before, in order. */
  readonly drains: Int32Array
  /** Moves with a timed dwell before them, in order. */
  readonly dwells: Int32Array
  /** Checkpoints in order, and when the moves they wait after end. */
  readonly checkpoints: readonly Checkpoint[]
  readonly checkpointEnds: Float64Array
  readonly checkpointAfter: ReadonlyMap<number, Checkpoint>
  /** Whether the plan has checkpoints of each kind, and tells when a tool is measured. */
  readonly waits: { readonly tool: boolean; readonly pause: boolean }
  readonly measures: boolean
}

const planMarks = new WeakMap<MotionPlan, PlanMarks>()

function marksOf(plan: MotionPlan): PlanMarks {
  const cached = planMarks.get(plan)
  if (cached) return cached
  const { count, kind, drainBefore, timing, reportTool } = plan
  const searches: number[] = []
  const drains: number[] = []
  const dwells: number[] = []
  let measures = false
  for (let move = 0; move < count; move++) {
    if (kind[move] === MOVE_KIND.probe) searches.push(move)
    if (drainBefore[move]) drains.push(move)
    if (
      move > 0 &&
      timing.start[move] >
        timing.start[move - 1] + timing.duration[move - 1] + 1e-6
    )
      dwells.push(move)
    if (reportTool[move] === MEASURING) measures = true
  }
  const checkpoints = [...plan.checkpoints].sort((a, b) => a.after - b.after)
  const marks: PlanMarks = {
    searches: Int32Array.from(searches),
    drains: Int32Array.from(drains),
    dwells: Int32Array.from(dwells),
    checkpoints,
    checkpointEnds: Float64Array.from(
      checkpoints,
      ({ after }) => timing.start[after] + timing.duration[after]
    ),
    checkpointAfter: new Map(checkpoints.map((point) => [point.after, point])),
    waits: {
      tool: checkpoints.some(({ kind: wait }) => wait === "tool-wait"),
      pause: checkpoints.some(({ kind: wait }) => wait === "pause"),
    },
    measures,
  }
  planMarks.set(plan, marks)
  return marks
}

/** The first index of a sorted array whose value is at least `value`. */
function lowerBound(values: ArrayLike<number>, value: number) {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (values[middle] < value) low = middle + 1
    else high = middle
  }
  return low
}

const endOf = ({ timing }: MotionPlan, move: number) =>
  timing.start[move] + timing.duration[move]

/** A place at a move and fraction, at the time it is there. */
const placeAt = (index: PlanIndex, move: number, fraction: number): Place => ({
  move: moveIndex(move),
  fraction,
  time: index.timeOf(moveIndex(move), fraction),
})

/** The place the plan is at at a time; in a dwell, after the move before it, at that time. */
function placeAtTime(index: PlanIndex, time: number): Place {
  const clamped = Math.max(0, Math.min(index.duration, time))
  const { move, fraction } = index.at(planSeconds(clamped))
  return { move, fraction, time: clamped }
}

/** Whether a place is in a dwell after its move rather than on it. */
const inDwell = (plan: MotionPlan, place: Place) =>
  place.time > endOf(plan, place.move) + 1e-6

/** Whether a place is at the end of a move after which the machine waits, and how. */
function checkpointAt(marks: PlanMarks, place: Place): Checkpoint | null {
  if (place.fraction < 1 - AT_END) return null
  return marks.checkpointAfter.get(place.move) ?? null
}

/** Huber's loss of a distance in spreads: squared near, linear far. */
const huber = (spreads: number) =>
  spreads <= HUBER ? spreads ** 2 / 2 : HUBER * spreads - HUBER ** 2 / 2

/** The distance from a point to a segment, as three coordinates each. */
function segmentDistance(point: Vec3, from: Vec3, to: Vec3) {
  const delta = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  const squared = delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2
  const along =
    squared > 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((point[0] - from[0]) * delta[0] +
              (point[1] - from[1]) * delta[1] +
              (point[2] - from[2]) * delta[2]) /
              squared
          )
        )
      : 0
  return [0, 1, 2].map(
    (axis) => point[axis] - (from[axis] + delta[axis] * along)
  ) as Vec3
}

/** What scores one report: its observation and the one before it, and the plan's. */
type Report = {
  readonly index: PlanIndex
  readonly plan: MotionPlan
  readonly marks: PlanMarks
  readonly observation: Observation
  readonly previous: Observation | null
  readonly bias: Registration
  /** The feed override, as a share: plan time per wall time on moves it applies to. */
  readonly override: number
  readonly scale: TrackerState["scale"]
  /** The touches it scores: only the latest when there is no report before. */
  readonly touches: readonly TouchObservation[]
}

/** A place's emission: its log-likelihood for the report, and how far its tip is (mm). */
type Emission = { readonly score: number; readonly residual: number }

/**
 * How far the reported tip is from a place, in spreads (`SIGMA`), and in mm as the place's frame
 * compares it (`comparesZ`); null without a trusted tip. While a new tool is measured its tip's Z
 * is as far off as its length is from the one before, so Z counts with a wide spread and not in
 * the mm; by work position it counts once the program has set work Z.
 */
function tipDistance(
  report: Report,
  place: Place
): { readonly spreads: number; readonly residual: number } | null {
  const { index, plan, observation, bias } = report
  if (!observation.positionTrusted) return null
  const { move } = place
  const tip = reportedTip(index, observation, move, bias)
  if (!tip) return null
  const machine = plan.frame[move] === MOVE_FRAME.machine
  let sigma: number
  let offset: Vec3
  if (plan.kind[move] === MOVE_KIND.probe) {
    sigma = machine ? SIGMA.probe.machine : SIGMA.probe.work
    offset = searchOffset(index, place, tip)
  } else {
    if (machine) sigma = SIGMA.machine
    else sigma = plan.kind[move] === MOVE_KIND.rapid ? SIGMA.rapid : SIGMA.feed
    const planned = index.pointOf(move, Math.min(1, place.fraction))
    offset = [0, 1, 2].map((axis) => tip[axis] - planned[axis]) as Vec3
  }
  const across = Math.hypot(offset[0], offset[1])
  let zSigma = Infinity
  if (machine)
    zSigma = plan.reportTool[move] === MEASURING ? SIGMA.measuring : sigma
  else if (move >= plan.workZFrom) zSigma = sigma
  return {
    spreads: Math.hypot(across / sigma, offset[2] / zSigma),
    residual: Math.hypot(across, comparesZ(index, move) ? offset[2] : 0),
  }
}

/**
 * How far a tip is from a place on a probe's search: short of its planned end, from where the
 * search has got to; at its end, from the way on past it, as far as `SEARCH_OVERRUN`, which it
 * may go before it touches.
 */
function searchOffset(index: PlanIndex, place: Place, tip: Vec3): Vec3 {
  const { plan } = index
  const { move } = place
  if (place.fraction < 1 - AT_END) {
    const planned = index.pointOf(move, place.fraction)
    return [0, 1, 2].map((axis) => tip[axis] - planned[axis]) as Vec3
  }
  const first = move * 3
  const end: Vec3 = [plan.to[first], plan.to[first + 1], plan.to[first + 2]]
  const length = plan.length[move]
  const past =
    length > 0
      ? (end.map(
          (value, axis) =>
            value +
            ((value - plan.from[first + axis]) / length) * SEARCH_OVERRUN
        ) as Vec3)
      : end
  return segmentDistance(tip, end, past)
}

/** The highest line a place can have reported: the last feed move's, or its own. */
const lineCeiling = (plan: MotionPlan, move: MoveIndex) =>
  Math.max(plan.reportLine[move], plan.line[move])

/**
 * How well the line a report gives fits a place. The firmware reports a feed move's own line
 * while it runs one at the report (`P:`); otherwise the line stays as the report before left it,
 * so it cannot be past the place's last feed move's line; a pause (Pause) reports the lines the
 * machine had read, and a resume or the next part of the program sets it anew.
 */
function lineFit(report: Report, place: Place): number {
  const { index, plan, observation, previous } = report
  const line = observation.line
  if (line === null) return 0
  const { move } = place
  let score = 0
  if (observation.lineBound !== null && plan.line[move] > observation.lineBound)
    score += LINE.unread
  const suspended = observation.state === "Pause"
  if (suspended) {
    const next = move + 1 < plan.count ? plan.line[move + 1] : Infinity
    return line >= plan.line[move] && line < Math.max(next, plan.line[move] + 1)
      ? score
      : score + LINE.changed
  }
  if (index.reportsOwnLine(move) && !inDwell(plan, place)) {
    if (line === plan.line[move]) return score
    // At a move's very ends the report may come from the move before or after it.
    if (
      place.fraction <= AT_END &&
      move > 0 &&
      line === plan.reportLine[move - 1]
    )
      return score + LINE.neighbour
    if (
      place.fraction >= 1 - AT_END &&
      move + 1 < plan.count &&
      line === plan.line[move + 1]
    )
      return score + LINE.neighbour
    return score + LINE.other
  }
  if (line > lineCeiling(plan, move)) return score + LINE.beyond
  if (!previous || line === previous.line) return score
  const restarted =
    observation.part !== previous.part ||
    observation.resumedLine !== previous.resumedLine ||
    previous.state === "Pause"
  return restarted ? score : score + LINE.changed
}

/** How well the tools reported fit a place's: the one in the spindle, and the one asked for. */
function toolFit({ plan, observation }: Report, { move }: Place): number {
  const { active, target } = observation.tool
  let score = 0
  const reported = plan.reportTool[move]
  if (active !== null && reported !== UNKNOWN_TOOL && active !== reported)
    score += TOOL.active
  const asked = plan.reportTarget[move]
  if (target !== null && asked !== UNKNOWN_TOOL && target !== asked)
    score += TOOL.target
  return score
}

/**
 * Whether a place is where the queue empties: at the end of a move before a drain, or at the start
 * of the move after it.
 */
function atDrain(plan: MotionPlan, place: Place) {
  const { move, fraction } = place
  if (fraction >= 1 - AT_END)
    return move + 1 >= plan.count || plan.drainBefore[move + 1] === 1
  return fraction <= AT_END && plan.drainBefore[move] === 1
}

/**
 * How well the machine's state fits a place: waiting for a tool change at a tool wait, for a
 * program pause at a pause, idle in a dwell or where the queue empties, running with a feed on
 * a move. A wait the plan has none of is not scored.
 */
function stateFit(report: Report, place: Place): number {
  const { plan, marks, observation } = report
  const { state, wait } = observation
  const checkpoint = checkpointAt(marks, place)
  if (state === "Tool" || wait?.reason === "tool-change") {
    if (!marks.waits.tool) return 0
    return checkpoint?.kind === "tool-wait" ? 0 : STATE.waiting
  }
  if (wait?.reason === "program-pause") {
    if (!marks.waits.pause) return 0
    const before =
      place.fraction <= AT_END &&
      place.move > 0 &&
      marks.checkpointAfter.get(place.move - 1)?.kind === "pause"
    return checkpoint?.kind === "pause" || before ? 0 : STATE.waiting
  }
  const dwelling = inDwell(plan, place)
  if (state === "Idle") return dwelling || atDrain(plan, place) ? 0 : STATE.idle
  if (state === "Run" && (observation.feed.current ?? 0) > 0 && dwelling)
    return STATE.running
  return 0
}

/** How well the feed the machine reports fits the middle of a place's move. */
function feedFit(report: Report, place: Place): number {
  const { plan, observation, override } = report
  const feed = observation.feed.current
  if (feed === null || feed <= 0 || inDwell(plan, place)) return 0
  if (place.fraction < FEED.from || place.fraction > FEED.to) return 0
  const { move } = place
  const expected =
    plan.timing.nominal[move] * (plan.overridable[move] ? override : 1)
  return Math.abs(feed - expected) <=
    Math.max(FEED.least, FEED.share * expected)
    ? 0
    : FEED.other
}

/** The last probe's search that ended at or before a place; -1 for none. */
function lastSearchBefore(marks: PlanMarks, place: Place) {
  const ended = place.fraction >= 1 - AT_END ? place.move + 1 : place.move
  const at = lowerBound(marks.searches, ended) - 1
  return at >= 0 ? marks.searches[at] : -1
}

/**
 * Whether a search could have made a contact: of its kind, ending near it in X and Y. The tool
 * sensor measures a new tool (where the plan tells, while the tool reported is -1); the stock is
 * touched with a probe.
 */
function searchMade(report: Report, search: number, touch: TouchObservation) {
  const { index, plan, marks, bias } = report
  const measuring = marks.measures && plan.reportTool[search] === MEASURING
  if (touch.kind === "tool-sensor") {
    if (marks.measures && !measuring) return false
  } else if (measuring || !isProbeSlot(plan.tool[search])) return false
  const offset = contactOffset(index, touch.point, moveIndex(search), bias)
  return !offset || Math.hypot(offset[0], offset[1]) <= TOUCH.reach
}

/** How well the latest contact a report brings fits a place: after the search that made it. */
function touchFit(report: Report, place: Place): number {
  const touch = report.touches.at(-1)
  if (!touch) return 0
  const search = lastSearchBefore(report.marks, place)
  return search >= 0 && searchMade(report, search, touch) ? 0 : TOUCH.other
}

/** How well a place explains a report, and how far the reported tip is from it. */
function emission(report: Report, place: Place): Emission {
  const distance = tipDistance(report, place)
  const position = distance ? -huber(distance.spreads) : 0
  return {
    score:
      position +
      lineFit(report, place) +
      toolFit(report, place) +
      stateFit(report, place) +
      feedFit(report, place) +
      touchFit(report, place),
    residual: distance?.residual ?? Number.NaN,
  }
}

/** How fast plan time goes at a place, relative to the plan, as the override and pace have it. */
function paceAt(report: Report, place: Place) {
  const { plan, override, scale } = report
  if (inDwell(plan, place)) return 1
  const { move } = place
  if (plan.kind[move] === MOVE_KIND.probe) return 1
  const pace =
    plan.kind[move] === MOVE_KIND.rapid || plan.routine[move]
      ? scale.rapid
      : scale.feed
  return (plan.overridable[move] ? override : 1) * pace
}

/** Plan time the machine is expected to have gone on from a place since the report before. */
function expectedFrom(report: Report, place: Place, wall: number) {
  const { observation, previous } = report
  if (previous && STOPPED.has(previous.state) && STOPPED.has(observation.state))
    return 0
  return paceAt(report, place) * wall
}

/**
 * Plan time of a probe's search between two places that its touching early may skip, when the
 * report brings a contact that says it did: the rest of the first search the way passes the end
 * of. A contact skips one search; a slow touch after a fast one comes in a later report.
 */
function skippable(report: Report, from: Place, to: Place) {
  const { plan, marks } = report
  if (!report.touches.length) return 0
  const first = lowerBound(marks.searches, from.move)
  if (first >= marks.searches.length) return 0
  const search = marks.searches[first]
  const end = endOf(plan, search)
  if (search > to.move || to.time + 1e-9 < end) return 0
  return Math.max(0, end - Math.max(from.time, plan.timing.start[search]))
}

/** Whether a checkpoint's wait lies between two plan times. */
function waitsBetween(marks: PlanMarks, from: number, to: number) {
  const at = lowerBound(marks.checkpointEnds, from - 1e-6)
  return (
    at < marks.checkpointEnds.length && marks.checkpointEnds[at] <= to + 1e-6
  )
}

/** How far plan time may stray (β) from what it is expected to go in a wall time. */
const paceSpread = (expected: number, wall: number) =>
  PACE_SPREAD.base + PACE_SPREAD.plan * expected + PACE_SPREAD.wall * wall

/** The log-likelihood of plan time going `excess` past what was expected, within a spread. */
const paceFit = (excess: number, spread: number, slowerFree: boolean) =>
  slowerFree && excess < 0
    ? (SLOWER_TIE * excess) / spread
    : -Math.abs(excess) / spread

/**
 * Where the latest contact a report brings pins the way between two places: the end of the first
 * search the way comes to, when it could have made the contact and the way passes its end, and
 * how long (wall s) before the report the contact came. A fast and a slow touch search at one
 * place; the first search on is the one that touched. Only a contact that came since the report
 * before pins, as a refined touch does; a routine's contacts and its Z probe's surface keep the
 * time of their first.
 */
function touchPin(report: Report, from: Place, to: Place, wall: number) {
  const { plan, marks, observation, previous } = report
  const touch = report.touches.at(-1)
  if (!touch || !previous) return null
  if (touch.at < previous.at || touch.at > observation.at) return null
  let at = lowerBound(marks.searches, from.move)
  while (
    at < marks.searches.length &&
    endOf(plan, marks.searches[at]) < from.time - BACK_SECONDS
  )
    at++
  if (at >= marks.searches.length) return null
  const search = marks.searches[at]
  const end = endOf(plan, search)
  if (to.time < end - 1e-9 || !searchMade(report, search, touch)) return null
  const since = Math.min(wall, (observation.at - touch.at) / 1000)
  return { search, end, since }
}

/**
 * The log-likelihood of the machine going from one place to another between reports: plan time
 * as far on as expected (`expectedFrom`), spread by β. Going back more than `BACK_SECONDS` is
 * impossible. Slower than expected is free where the machine may have waited: past a checkpoint,
 * or stopped or idle at either report. A contact since the report before pins the way at the end
 * of its search (`touchPin`): up to there the search may have touched early, from there plan time
 * goes on for as long as since the contact; a contact otherwise lets the way skip the rest of a
 * search (`skippable`), anywhere up to as far on as expected after it.
 */
function transition(
  report: Report,
  from: Place,
  to: Place,
  wall: number
): number {
  const elapsed = to.time - from.time
  if (elapsed < -BACK_SECONDS) return -Infinity
  const { plan, observation, previous, marks } = report
  const slowerFree =
    SLOWER_FREE.has(observation.state) ||
    (!!previous && SLOWER_FREE.has(previous.state)) ||
    waitsBetween(marks, from.time, to.time)
  const pin = touchPin(report, from, to, wall)
  if (pin) {
    const before = expectedFrom(report, from, wall - pin.since)
    const rest = pin.end - Math.max(from.time, plan.timing.start[pin.search])
    const reaching = Math.max(0, pin.end - from.time - before - rest)
    const after = placeAtTime(report.index, pin.end + 1e-6)
    const since = expectedFrom(report, after, pin.since)
    return (
      -reaching / paceSpread(before, wall - pin.since) +
      paceFit(
        to.time - pin.end - since,
        paceSpread(since, pin.since),
        slowerFree
      )
    )
  }
  const expected = expectedFrom(report, from, wall)
  const spread = paceSpread(expected, wall)
  let excess = elapsed - expected
  const skipped = excess > 0 ? skippable(report, from, to) : 0
  if (skipped > 0) excess = Math.max(0, excess - skipped)
  return paceFit(excess, spread, slowerFree || skipped > 0)
}

/** A candidate place and its score so far. */
type Scored = Place & { readonly score: number; readonly emission: Emission }

/** A key for places that report alike, which merge when near in time. */
const reportsAlike = (plan: MotionPlan, marks: PlanMarks, place: Place) =>
  `${plan.reportLine[place.move]}:${plan.reportTool[place.move]}:${plan.reportTarget[place.move]}:${plan.frame[place.move]}:${checkpointAt(marks, place)?.kind ?? ""}`

/** The best places, merged where near in time and reporting alike, at most `BEAM`. */
function keepBest(
  plan: MotionPlan,
  marks: PlanMarks,
  scored: readonly Scored[]
): Scored[] {
  const sorted = scored
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => b.score - a.score)
  const kept: Scored[] = []
  const keys: string[] = []
  for (const place of sorted) {
    if (kept.length >= BEAM) break
    const key = reportsAlike(plan, marks, place)
    const merged = kept.some(
      (other, at) =>
        keys[at] === key && Math.abs(other.time - place.time) <= SAME_TIME
    )
    if (merged) continue
    kept.push(place)
    keys.push(key)
  }
  return kept
}

/** Moves [first, end) of the plan, clamped to it. */
const rangeOf = (plan: MotionPlan, first: number, end: number) => ({
  first: moveIndex(Math.max(0, Math.min(plan.count, first))),
  end: moveIndex(Math.max(0, Math.min(plan.count, end))),
})

/** How many moves an X and Y search goes through at most, before work Z is set. */
const XY_SCAN = 20_000

/**
 * Places near the reported tips in a range of moves: each tip projected onto the moves of its
 * frame within `NEAR_RADIUS`, by work position as each work offset in the range shifts it (in X
 * and Y alone before the program sets work Z), by machine position in X and Y alone while a
 * tool is measured.
 */
function nearPlaces(
  report: Report,
  first: number,
  end: number,
  limit: number
): Place[] {
  const { index, plan, observation, bias } = report
  if (!observation.positionTrusted || end <= first) return []
  const places: Place[] = []
  const project = (move: number, tip: Vec3, flat: boolean) => {
    const fraction = flat
      ? flatFraction(plan, move, tip)
      : index.project(moveIndex(move), tip).fraction
    if (fraction !== null) places.push(placeAt(index, move, fraction))
  }
  const work = observation.workTip
  if (work) {
    const zFrom = Math.max(first, plan.workZFrom)
    const shifts = new Map<string, Vec3>()
    for (const { from, shift } of plan.shifts)
      if (from < end) shifts.set(shift.join(), shift)
    for (const shift of shifts.values()) {
      const tip: Vec3 = [0, 1, 2].map(
        (axis) => work[axis] + shift[axis] - bias.work[axis]
      ) as Vec3
      const sameShift = (move: number) =>
        index.shiftAt(moveIndex(move)).join() === shift.join()
      for (const move of index.near(
        tip,
        NEAR_RADIUS.work,
        rangeOf(plan, zFrom, end),
        limit
      ))
        if (plan.frame[move] === MOVE_FRAME.work && sameShift(move))
          project(move, tip, false)
      // Before work Z is set, the reported work Z is not the plan's: X and Y only.
      const flatEnd = Math.min(end, plan.workZFrom, first + XY_SCAN)
      for (let move = first; move < flatEnd; move++)
        if (
          plan.frame[move] === MOVE_FRAME.work &&
          sameShift(move) &&
          flatDistance(plan, move, tip) <= NEAR_RADIUS.work
        )
          project(move, tip, true)
    }
  }
  const machine = observation.machineTip
  if (machine) {
    const tip: Vec3 = [0, 1, 2].map(
      (axis) => machine[axis] - bias.machine[axis]
    ) as Vec3
    for (const move of index.near(
      tip,
      NEAR_RADIUS.machine,
      rangeOf(plan, first, end),
      limit
    ))
      if (plan.frame[move] === MOVE_FRAME.machine) project(move, tip, false)
    // Measuring a new tool, its tip's Z is not known: X and Y only, over the routine's moves.
    if (observation.tool.active === MEASURING)
      for (let move = first; move < Math.min(end, first + XY_SCAN); move++)
        if (
          plan.frame[move] === MOVE_FRAME.machine &&
          flatDistance(plan, move, tip) <= NEAR_RADIUS.machine
        )
          project(move, tip, true)
  }
  return places
}

/** How far along a move it comes nearest to a point in X and Y. */
function flatFraction(plan: MotionPlan, move: number, point: Vec3) {
  const first = move * 3
  const dx = plan.to[first] - plan.from[first]
  const dy = plan.to[first + 1] - plan.from[first + 1]
  const squared = dx ** 2 + dy ** 2
  // A move (nearly) straight up or down tells nothing of how far along it is in X and Y.
  if (Math.sqrt(squared) < FLAT_LEAST * plan.length[move]) return null
  const along =
    ((point[0] - plan.from[first]) * dx +
      (point[1] - plan.from[first + 1]) * dy) /
    squared
  return Math.max(0, Math.min(1, along))
}

/** How near a move comes to a point in X and Y. */
function flatDistance(plan: MotionPlan, move: number, point: Vec3) {
  const fraction = flatFraction(plan, move, point) ?? 0
  const first = move * 3
  const x = plan.from[first] + (plan.to[first] - plan.from[first]) * fraction
  const y =
    plan.from[first + 1] +
    (plan.to[first + 1] - plan.from[first + 1]) * fraction
  return Math.hypot(point[0] - x, point[1] - y)
}

/**
 * Where the queue empties, dwells start and end, the machine waits, and probes' searches end in
 * a range of moves, at most `limit` of them: places a report may be at that time alone does not
 * lead to.
 */
function boundaryPlaces(
  report: Report,
  first: number,
  end: number,
  limit: number
): Place[] {
  const { index, plan, marks } = report
  const places: Place[] = []
  const add = (move: number, fraction: number) => {
    if (move >= 0 && move < plan.count)
      places.push(placeAt(index, move, fraction))
  }
  for (const point of marks.checkpoints)
    if (point.after >= first && point.after < end) add(point.after, 1)
  for (const list of [marks.drains, marks.dwells])
    for (
      let at = lowerBound(list, first);
      at < list.length && list[at] < end && places.length < limit;
      at++
    ) {
      const move = list[at]
      add(move - 1, 1)
      add(move, 0)
      if (list === marks.dwells && move > 0)
        // The dwell's own place: after the move before it, at the dwell's end.
        places.push({
          move: moveIndex(move - 1),
          fraction: 1,
          time: plan.timing.start[move] - 1e-3,
        })
    }
  return [...places, ...touchPlaces(report, first, end)]
}

/** Where the searches that may have made the latest contact reported end, in a range of moves. */
function touchPlaces(report: Report, first: number, end: number): Place[] {
  const { index, marks } = report
  const touch = report.touches.at(-1)
  if (!touch) return []
  const places: Place[] = []
  for (
    let at = lowerBound(marks.searches, first);
    at < marks.searches.length && marks.searches[at] < end;
    at++
  ) {
    const search = marks.searches[at]
    if (searchMade(report, search, touch))
      places.push(placeAt(index, search, 1))
  }
  return places.slice(-BEAM)
}

/**
 * The moves the machine can be making by the line and the read position it reports: from where
 * the line's feed moves (or, for a line no move reports, the line itself) start, up to the
 * first line past what it has read.
 */
function reportedRange(index: PlanIndex, observation: Observation) {
  const { plan } = index
  const line = observation.line ?? 0
  let first = 0
  if (line > 0) {
    const reporting = index.reporting(sourceLine(line)).first
    const lineOwn = index.firstMoveFrom(sourceLine(line + 1)) - 1
    first = Math.max(0, Math.min(reporting, lineOwn))
  }
  const end =
    observation.lineBound === null
      ? plan.count
      : Math.max(
          first + 1,
          index.firstMoveFrom(sourceLine(observation.lineBound + 1))
        )
  return rangeOf(plan, first, end)
}

/**
 * Places to find the machine anew from a report alone: near its tips in the moves its line and
 * read position allow (`reportedRange`), of the tool it reports where any is; where it waits,
 * while it waits; the range's start. Without a trusted position, only the start and the waits.
 */
function globalPlaces(report: Report): Place[] {
  const { index, plan, marks, observation } = report
  const { first, end } = reportedRange(index, observation)
  const places: Place[] = [placeAt(index, first, 0)]
  if (observation.wait || WAITING.has(observation.state))
    for (const point of marks.checkpoints)
      if (point.after >= first && point.after < end)
        places.push(placeAt(index, point.after, 1))
  const near = nearPlaces(report, first, end, GLOBAL_CANDIDATES / 2)
  const active = observation.tool.active
  const holding = near.filter(
    ({ move }) =>
      active === null ||
      plan.reportTool[move] === UNKNOWN_TOOL ||
      plan.reportTool[move] === active
  )
  places.push(...(holding.length ? holding : near))
  places.push(...touchPlaces(report, first, end))
  return places.slice(0, GLOBAL_CANDIDATES)
}

/**
 * Places the machine may have gone on to from the beam: each hypothesis as far on as expected,
 * and staying; near the reported tips, where it waits, dwells or the queue empties, and where a
 * reported contact's search ends, from the earliest hypothesis to as far as the latest may have
 * gone with room to spare.
 */
function localPlaces(
  report: Report,
  beam: readonly Hypothesis[],
  wall: number
): Place[] {
  const { index } = report
  const places: Place[] = []
  let first = Infinity
  let reach = 0
  for (const hypothesis of beam) {
    const place: Place = hypothesis
    const expected = expectedFrom(report, place, wall)
    const spread = paceSpread(expected, wall)
    places.push(place, placeAtTime(index, place.time + expected))
    first = Math.min(first, placeAtTime(index, place.time - BACK_SECONDS).move)
    reach = Math.max(reach, place.time + expected + 4 * spread + 2)
  }
  const end = placeAtTime(index, reach).move + 1
  places.push(...nearPlaces(report, first, end, NEAR_LIMIT))
  places.push(...boundaryPlaces(report, first, end, 4 * BEAM))
  return places
}

/**
 * Where along the best place's own move the reported tip is, for the estimate. The best path
 * weighs the tip against the expected pace, which leaves it a little behind a tip it can trust
 * (by σ²/(v²β) of plan time at a speed v); along its move the tip says where it is. Only while
 * the machine runs, out of a dwell, and short of a probe's search's end, past which it may go.
 */
function alongTip(report: Report, place: Place): Place {
  const { index, plan, observation, bias } = report
  if (!observation.positionTrusted || STOPPED.has(observation.state))
    return place
  if (inDwell(plan, place)) return place
  if (plan.kind[place.move] === MOVE_KIND.probe && place.fraction >= 1 - AT_END)
    return place
  const tip = reportedTip(index, observation, place.move, bias)
  if (!tip) return place
  const fraction = comparesZ(index, place.move)
    ? index.project(place.move, tip).fraction
    : flatFraction(plan, place.move, tip)
  return fraction === null ? place : placeAt(index, place.move, fraction)
}

/** The posterior of each scored place (softmax), in their order. */
function posteriors(scores: readonly number[]) {
  const best = Math.max(...scores)
  const weights = scores.map((score) => Math.exp(score - best))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  return weights.map((weight) => weight / total)
}

/** The pace a move goes at: a feed move's, or a rapid's and a routine's; null for a search. */
function paceKind(plan: MotionPlan, move: MoveIndex): "feed" | "rapid" | null {
  if (plan.kind[move] === MOVE_KIND.probe) return null
  return plan.kind[move] === MOVE_KIND.rapid || plan.routine[move]
    ? "rapid"
    : "feed"
}

/**
 * The paces learnt from two estimates in a row the tracker is sure of while the machine runs, on
 * moves of one kind, as far apart as `SCALE` takes: each kind's pace takes on a share of how far
 * plan time went per wall time at the override. This absorbs limits the plan has wrong.
 */
function learnScale(
  report: Report,
  scale: TrackerState["scale"],
  before: Estimate | null,
  after: Place,
  wall: number
): TrackerState["scale"] {
  const { plan, marks, observation, previous, override } = report
  if (!before || !previous) return scale
  if (before.status !== "locked" && before.status !== "off-plan") return scale
  if (observation.state !== "Run" || previous.state !== "Run") return scale
  if (wall < SCALE.from || wall > SCALE.to) return scale
  const kind = paceKind(plan, after.move)
  if (!kind || kind !== paceKind(plan, before.move)) return scale
  if (waitsBetween(marks, before.time, after.time)) return scale
  const dwells = lowerBound(marks.dwells, before.move + 1)
  if (dwells < marks.dwells.length && marks.dwells[dwells] <= after.move)
    return scale
  const rate = plan.overridable[after.move] ? override : 1
  const pace = (after.time - before.time) / (rate * wall)
  const learnt = Math.max(
    SCALE.least,
    Math.min(SCALE.most, (1 - SCALE.weight) * scale[kind] + SCALE.weight * pace)
  )
  return { ...scale, [kind]: learnt }
}

/** A tracker state for a job and plan with nothing observed yet. */
function started(jobId: string, index: PlanIndex): HmmState {
  return {
    jobId,
    planKey: index.plan.key,
    beam: [],
    last: null,
    estimate: null,
    misses: 0,
    offPlan: { on: false, near: 0 },
    bias: NO_BIAS,
    scale: { feed: 1, rapid: 1 },
    settled: 0,
    touch: null,
  }
}

const settledOf = (state: TrackerState) =>
  "settled" in state && typeof state.settled === "number" ? state.settled : 0

/** The last contact a tracker state matched to its search, and how far off it was; null without. */
export function lastTouch(state: TrackerState): TouchOffset | null {
  return "touch" in state ? (state.touch as TouchOffset | null) : null
}

/** An estimate of a place, as the tracker reports it. */
function estimateOf(
  report: Report,
  place: Place,
  fields: Pick<Estimate, "status" | "rate" | "spread" | "residual">
): Estimate {
  const { index, plan, observation, bias } = report
  return {
    at: observation.at,
    time: planSeconds(place.time),
    move: place.move,
    fraction: place.fraction,
    line: sourceLine(plan.line[place.move]),
    tip: reportedTip(index, observation, place.move, bias),
    ...fields,
  }
}

/**
 * What a report outside play does: before the program plays, nothing; once it played all of it,
 * the plan's end; after it stopped, the estimate holds, at rate 0.
 */
function outsidePlay(
  index: PlanIndex,
  state: HmmState,
  observation: Observation
): HmmState | null {
  const { plan } = index
  if (BEFORE.has(observation.phase) && observation.line === null)
    return { ...state, last: observation }
  if (PLAYED.has(observation.phase) && plan.count > 0) {
    const last = plan.count - 1
    return {
      ...state,
      last: observation,
      estimate: {
        at: observation.at,
        time: index.duration,
        move: moveIndex(last),
        fraction: 1,
        line: sourceLine(plan.line[last]),
        rate: 0,
        status: "locked",
        spread: 0,
        tip: null,
        residual: Number.NaN,
      },
    }
  }
  if (observation.phase === "running" || observation.phase === "paused")
    return null
  if (BEFORE.has(observation.phase)) return null
  return {
    ...state,
    last: observation,
    estimate: state.estimate && { ...state.estimate, rate: 0 },
  }
}

/**
 * A tracker state after a report: the beam gone on from its hypotheses (or found anew), scored,
 * merged and cut to the best `BEAM`; the estimate at the best, with its status and rate; and the
 * bias and paces learnt from it. A report of another job or plan starts over.
 */
function observe(
  index: PlanIndex,
  given: TrackerState,
  observation: Observation
): HmmState {
  const { plan } = index
  const fresh = given.jobId !== observation.jobId || given.planKey !== plan.key
  const state: HmmState = fresh
    ? started(observation.jobId, index)
    : { settled: settledOf(given), touch: lastTouch(given), ...given }
  const previous = state.last?.jobId === observation.jobId ? state.last : null
  if (previous && observation.at <= previous.at) return state
  if (!plan.count) return { ...state, last: observation }
  const outside = outsidePlay(index, state, observation)
  if (outside) return outside
  const marks = marksOf(plan)
  const wall = previous ? (observation.at - previous.at) / 1000 : 0
  const latest = observation.touches.at(-1)
  const report: Report = {
    index,
    plan,
    marks,
    observation,
    previous,
    bias: state.bias,
    override:
      (observation.feed.override ?? previous?.feed.override ?? 100) / 100,
    scale: state.scale,
    touches: previous ? observation.touches : latest ? [latest] : [],
  }

  // The beam goes on from where it was, unless it is empty or lost, or reports stopped a while.
  const findAnew =
    !state.beam.length ||
    !previous ||
    wall > GAP_SECONDS ||
    state.misses >= LOST_AFTER
  const scoreAnew = () =>
    globalPlaces(report).map((place): Scored => {
      const fit = emission(report, place)
      return { ...place, score: fit.score, emission: fit }
    })
  let anew = findAnew
  let scored = findAnew
    ? scoreAnew()
    : localPlaces(report, state.beam, wall).map((place): Scored => {
        const fit = emission(report, place)
        let best = -Infinity
        for (const hypothesis of state.beam)
          best = Math.max(
            best,
            hypothesis.score + transition(report, hypothesis, place, wall)
          )
        return { ...place, score: best + fit.score, emission: fit }
      })
  const bestFit = (places: readonly Scored[]) =>
    places.reduce(
      (best, place) => Math.max(best, place.emission.score),
      -Infinity
    )
  let misses = bestFit(scored) < MISS ? state.misses + 1 : 0
  let beam = keepBest(plan, marks, scored)
  if (!anew && (misses >= LOST_AFTER || !beam.length)) {
    anew = true
    scored = scoreAnew()
    beam = keepBest(plan, marks, scored)
    if (bestFit(scored) >= MISS) misses = 0
  }
  if (!beam.length) return { ...state, last: observation, misses, beam: [] }

  const top = beam[0]
  const scores = beam.map(({ score }) => score)
  const shares = posteriors(scores)
  const spread = beam.reduce(
    (most, place, at) =>
      shares[at] >= AMBIGUOUS.counted
        ? Math.max(most, Math.abs(place.time - top.time))
        : most,
    0
  )
  const consistent = misses === 0
  const settled = anew
    ? consistent
      ? 1
      : 0
    : consistent
      ? state.settled + 1
      : state.settled
  const shown = alongTip(report, top)
  const residual =
    shown === top
      ? top.emission.residual
      : (tipDistance(report, shown)?.residual ?? top.emission.residual)

  // Off the plan from far enough, back on it after reports in a row near enough.
  let { offPlan } = state
  if (!Number.isNaN(residual))
    offPlan = offPlan.on
      ? residual < OFF_PLAN.leave
        ? offPlan.near + 1 >= OFF_PLAN.reports
          ? { on: false, near: 0 }
          : { on: true, near: offPlan.near + 1 }
        : { on: true, near: 0 }
      : { on: residual > OFF_PLAN.enter, near: 0 }

  const waiting =
    (!!observation.wait || WAITING.has(observation.state)) &&
    !!checkpointAt(marks, top)
  const ambiguous = spread > AMBIGUOUS.spread && shares[0] < AMBIGUOUS.posterior
  // What the status would be on the plan, which learning the bias and pace goes by.
  const sure: TrackStatus = ambiguous
    ? "ambiguous"
    : settled < SETTLED
      ? "acquiring"
      : "locked"
  let status: TrackStatus = sure
  if (offPlan.on) status = "off-plan"
  if (misses >= LOST_AFTER) status = "lost"
  if (waiting) status = "waiting"

  const stopped =
    STOPPED.has(observation.state) ||
    (observation.state === "Idle" && !inDwell(plan, top))
  const rate = waiting || stopped ? 0 : paceAt(report, top)
  // Ambiguous, the estimate holds where it was rather than go to and fro between places.
  const held =
    status === "ambiguous" && state.estimate && !fresh ? state.estimate : null
  const estimate: Estimate = held
    ? {
        ...held,
        at: observation.at,
        status,
        rate: 0,
        spread,
        tip: reportedTip(index, observation, held.move, state.bias),
        residual: tipDistance(report, held)?.residual ?? Number.NaN,
      }
    : estimateOf(report, shown, { status, rate, spread, residual })

  const learning = sure === "locked" && !waiting && misses === 0
  const bias =
    learning && observation.state === "Run"
      ? register(index, state.bias, observation, shown.move, shown.fraction)
      : state.bias
  const scale = learning
    ? learnScale(report, state.scale, state.estimate, shown, wall)
    : state.scale

  // The latest contact, by the search that made it: how far off the plate's model is there.
  let { touch } = state
  const contact = report.touches.at(-1)
  if (contact) {
    const search = lastSearchBefore(marks, top)
    const offset =
      search >= 0
        ? contactOffset(index, contact.point, moveIndex(search), state.bias)
        : null
    if (offset)
      touch = { kind: contact.kind, search: moveIndex(search), offset }
  }

  const best = top.score
  return {
    ...state,
    beam: beam.map(({ move, fraction, time, score }): Hypothesis => ({
      move,
      fraction,
      time: planSeconds(time),
      score: score - best,
    })),
    last: observation,
    estimate,
    misses,
    offPlan,
    bias,
    scale,
    settled,
    touch,
  }
}

/**
 * The hidden Markov model tracker over a beam of hypotheses. Its state carries beside a
 * tracker's how many consistent reports in a row it has had since it found the machine, and the
 * last contact reported (`lastTouch`).
 */
export const hmmTracker: Tracker | null = {
  name: "hmm",
  start: started,
  observe,
}
