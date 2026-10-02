import type { JobPhase, JobWait, MachineState } from "@/machine/contract"
import type {
  MoveIndex,
  PlanSeconds,
  SourceLine,
  Vec3,
} from "@/domain/motion/spaces"
import type { PlanIndex } from "@/domain/motion/types"

/** A contact the machine reported measuring during the job. */
export type TouchObservation = {
  readonly at: number
  readonly kind: "surface" | "tool-sensor" | "contact"
  readonly tool: number | null
  /** machine frame, placed */
  readonly point: Vec3 | null
  readonly line: number | null
}

/** What one status report of a job tells about where the machine is in its plan. */
export type Observation = {
  /** Telemetry.receivedAt (ms, Date.now clock) */
  readonly at: number
  readonly jobId: string
  readonly part: number
  readonly phase: JobPhase
  readonly state: MachineState
  /** job.progress.line (program lines) */
  readonly line: number | null
  readonly resumedLine: number | null
  /** index.lineAtBytes(min(1,(percent+1)/100)) + 2 */
  readonly lineBound: number | null
  /**
   * Whether the positions are where the machine is: while it moves (Run, Home), once its queue
   * has emptied (Tool, Idle) and in a Pause already reported; not in Hold, Wait, Alarm or Sleep.
   */
  readonly positionTrusted: boolean
  /** place([MPos.x, MPos.y, MPos.z − toolOffset]) */
  readonly machineTip: Vec3 | null
  /** WPos */
  readonly workTip: Vec3 | null
  readonly toolOffset: number | null
  /** T:, requestedTool */
  readonly tool: {
    readonly active: number | null
    readonly target: number | null
  }
  /** F:[0], F:[2] */
  readonly feed: {
    readonly current: number | null
    readonly override: number | null
  }
  readonly wait: JobWait | null
  /** job.measurements.length */
  readonly measured: number
  /** measurements[previous.measured ..] */
  readonly touches: readonly TouchObservation[]
}

export type TrackStatus =
  "acquiring" | "locked" | "ambiguous" | "off-plan" | "waiting" | "lost"

/** Where in its plan the machine may be, and how well that explains what it reported. */
export type Hypothesis = {
  readonly move: MoveIndex
  readonly fraction: number
  readonly time: PlanSeconds
  readonly score: number
}

/** Where a tracker places the machine in its plan after an observation. */
export type Estimate = {
  readonly at: number
  readonly time: PlanSeconds
  readonly move: MoveIndex
  readonly fraction: number
  readonly line: SourceLine
  /** plan s per wall s; 0 waiting */
  readonly rate: number
  readonly status: TrackStatus
  /** plan s */
  readonly spread: number
  /** reported tip, plan coords (off-plan drawing) */
  readonly tip: Vec3 | null
  /** mm, NaN untrusted */
  readonly residual: number
}

/** A tracker's state for one job and plan, as observations reduce it. */
export type TrackerState = {
  readonly jobId: string
  readonly planKey: string
  readonly beam: readonly Hypothesis[]
  readonly last: Observation | null
  readonly estimate: Estimate | null
  readonly misses: number
  readonly offPlan: { readonly on: boolean; readonly near: number }
  readonly bias: {
    readonly machine: Vec3
    readonly work: Vec3
    readonly samples: number
  }
  readonly scale: { readonly feed: number; readonly rapid: number }
}

/** Where a job's machine is in its plan, as a pure reducer over its observations. */
export interface Tracker {
  readonly name: "greedy" | "hmm"
  start: (jobId: string, index: PlanIndex) => TrackerState
  observe: (
    index: PlanIndex,
    state: TrackerState,
    observation: Observation
  ) => TrackerState
}
