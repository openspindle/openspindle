import type { NcBlock } from "@/machine/contract"
import type { ProbeStart } from "./placement"
import type { GridParams } from "./tasks/grid/params"
import type { OriginParams } from "./tasks/origin/params"

/** A probing operation's NC as a method writes it, and where a job pauses in it. */
export type ProbeProgram = {
  /** Newline-terminated NC. */
  readonly nc: string
  /** One-based line of the pause to review what was measured; null when the job does not pause. */
  readonly reviewLine: number | null
}

/** What every planned probing operation has: its parameters, checked, and where it starts. */
export type ProbingPlan<TParams> = {
  readonly params: TParams
  readonly start: ProbeStart
}

/**
 * A planned height grid: its size, points and clearance and whether the job pauses to review
 * what it measured, checked, and where it starts.
 */
export type GridPlan = ProbingPlan<Omit<GridParams, "placement">>

/** A planned 3D probing. */
export type OriginPlan = ProbingPlan<OriginParams> & {
  /** The work Z the probe comes down to over the start first; null when the placement has none. */
  readonly height: number | null
}

/** How a program's sections see a machine's probing NC, in any NC file. */
export interface ProbingSections {
  /** Whether a block probes a height grid. */
  probesGrid: (block: NcBlock) => boolean
  /**
   * The name of the touch-off a block starts with `tool` active, which tells which probe
   * touches; null when it touches nothing.
   */
  touchOff: (block: NcBlock, tool: number | null) => string | null
  /**
   * Whether a block continues a touch-off once one has started, such as another touch, setting
   * work Z where it touched or lifting off.
   */
  continuesTouchOff: (block: NcBlock) => boolean
}
