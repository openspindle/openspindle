import type {
  MoveIndex,
  PlanSeconds,
  SourceLine,
  Vec3,
} from "@/domain/motion/spaces"
import type { PlanIndex } from "@/domain/motion/types"
import type { TrackStatus } from "@/domain/tracking/types"

/** Where a plan's playback is at one moment: what every view of a job draws from. */
export type PlaybackFrame = {
  readonly index: PlanIndex
  readonly source: "preview" | "playback" | "live"
  readonly time: PlanSeconds
  readonly move: MoveIndex
  readonly fraction: number
  /** [0, revealed) drawn made; the move under way drawn to tip */
  readonly revealed: MoveIndex
  readonly tip: Vec3
  readonly offPlan: boolean
  readonly tool: number | null
  readonly line: SourceLine
  readonly step: number
  /** path ahead [move, aheadEnd); === move: none */
  readonly aheadEnd: MoveIndex
  readonly nextTouch: MoveIndex | -1
  readonly status: TrackStatus | "simulated"
}

/**
 * Where the frame on show comes from: readers take it each animation frame, and are told when it
 * changes without their owner rendering again.
 */
export type FrameSource = {
  readonly get: () => PlaybackFrame | null
  readonly subscribe: (listener: () => void) => () => void
}

/** A frame source its owner sets. */
export class FrameStore implements FrameSource {
  private frame: PlaybackFrame | null = null
  private readonly listeners = new Set<() => void>()
  readonly get = () => this.frame
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(frame: PlaybackFrame | null) {
    this.frame = frame
    for (const listener of this.listeners) listener()
  }
}
