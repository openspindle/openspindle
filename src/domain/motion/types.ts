import type { GCodeProgram, Point3 } from "@/domain/nc/gcode"
import type { MachineLimits } from "./limits"
import type {
  MoveIndex,
  MovePoint,
  MoveRange,
  PlanSeconds,
  SourceLine,
  Vec3,
} from "./spaces"

export const MOVE_KIND = { rapid: 0, feed: 1, arc: 2, probe: 3 } as const
export type MoveKind = (typeof MOVE_KIND)[keyof typeof MOVE_KIND]
/** Placed by WPos | by MPos. */
export const MOVE_FRAME = { work: 0, machine: 1 } as const
export type MoveFrame = (typeof MOVE_FRAME)[keyof typeof MOVE_FRAME]
/** A tool the machine does not report, or that the plan cannot tell. */
export const UNKNOWN_TOOL = -2

/** Where the machine waits for the user: after a move, until a tool is changed or a pause resumed. */
export type Checkpoint = {
  /** the machine waits after this move ends */
  readonly after: MoveIndex
  readonly kind: "tool-wait" | "pause"
  readonly line: SourceLine
  /** tool-wait: the tool asked for */
  readonly tool: number | null
}

/** A plan's moves as its timing reads them. */
export type TimingInput = {
  readonly count: number
  /** count*3, plan coordinates */
  readonly from: Float32Array
  readonly to: Float32Array
  readonly kind: Uint8Array
  readonly line: Uint32Array
  /** requested mm/min before caps (program M220 included) */
  readonly rate: Float32Array
  /** 0: probe search */
  readonly overridable: Uint8Array
  readonly drainBefore: Uint8Array
  /** s */
  readonly dwellBefore: Float32Array
  /** s */
  readonly dwellAfterLast: number
}

/** When each of a plan's moves starts, how long it takes and how fast it goes. */
export type PlanTiming = {
  /** PlanSeconds of each move's start */
  readonly start: Float64Array
  readonly duration: Float32Array
  /** mm/s */
  readonly entry: Float32Array
  readonly cruise: Float32Array
  readonly exit: Float32Array
  /** mm/s² */
  readonly accel: Float32Array
  /** mm/min after caps: the F: value at 100 % */
  readonly nominal: Float32Array
  readonly total: number
}

/**
 * The moves a machine makes for a plate's program, with what it reports during each and when
 * each runs: built once per program, setup and limits, and never changed.
 */
export type MotionPlan = {
  /** kit|setup hash|limits.key|source hash (cyrb53) */
  readonly key: string
  /** machine program; segments[i] is move i (viewer draws it) */
  readonly program: GCodeProgram
  readonly count: number
  readonly from: Float32Array
  readonly to: Float32Array
  readonly length: Float32Array
  readonly kind: Uint8Array
  readonly routine: Uint8Array
  readonly frame: Uint8Array
  readonly overridable: Uint8Array
  readonly drainBefore: Uint8Array
  readonly line: Uint32Array
  /** -1 none */
  readonly probePoint: Int32Array
  /** drawn tool */
  readonly tool: Int32Array
  readonly reportLine: Uint32Array
  readonly reportTool: Int32Array
  readonly reportTarget: Int32Array
  readonly timing: PlanTiming
  readonly checkpoints: readonly Checkpoint[]
  readonly shifts: readonly { readonly from: MoveIndex; readonly shift: Vec3 }[]
  readonly workZFrom: MoveIndex
  readonly limits: MachineLimits
}

/** Queries on a plan: between its times, moves, lines and points. */
export interface PlanIndex {
  readonly plan: MotionPlan
  readonly duration: PlanSeconds
  /** in a dwell before i: i−1 at 1 */
  at: (time: PlanSeconds) => MovePoint
  /** via kinematics, not linear */
  timeOf: (move: MoveIndex, fraction?: number) => PlanSeconds
  pointOf: (move: MoveIndex, fraction: number, out?: Point3) => Point3
  pointAt: (time: PlanSeconds, out?: Point3) => Point3
  /** mm/s at 100 %; 0 in dwells */
  speedAt: (time: PlanSeconds) => number
  firstMoveFrom: (line: SourceLine) => MoveIndex
  /** a feed block the P: line reports */
  reportsOwnLine: (move: MoveIndex) => boolean
  /** reportLine === line (contiguous) */
  reporting: (line: SourceLine) => MoveRange
  lineAtBytes: (fraction: number) => SourceLine
  near: (
    point: Point3,
    radius: number,
    within: MoveRange,
    limit: number
  ) => readonly MoveIndex[]
  project: (
    move: MoveIndex,
    point: Point3
  ) => { readonly fraction: number; readonly distance: number }
  nextTouch: (from: MoveIndex) => MoveIndex | -1
  aheadEnd: (time: PlanSeconds, seconds: number) => MoveIndex
  checkpointAfter: (move: MoveIndex) => Checkpoint | null
  nextCheckpoint: (time: PlanSeconds) => Checkpoint | null
  /** work move point = WPos + shiftAt(move) */
  shiftAt: (move: MoveIndex) => Vec3
}
