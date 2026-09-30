import type { NcBlock } from "@/machine/contract"
import type { GCodeProgram } from "@/domain/nc/gcode"
import type { AutoLevelSpecs, AutoLevelParams } from "../auto-level/params"
import type { ProbeGrid, ProbePoint } from "../auto-level/probe-grid"
import type { AutoScanParams, AutoScanSpecs } from "../auto-scan/params"
import type {
  AutoZHeightField,
  AutoZHeightSpecs,
  AutoZHeightParams,
} from "../auto-z-height/params"
import type { ProbeTouch } from "../auto-z-height/probe-touch"
import type { Rect } from "../geometry/rect"
import type { Probe3dSpecs, Probe3dParams } from "../probe-3d/params"
import type { ParameterSpecs } from "./parameters"
import type { ProbeStart } from "./placement"

/** A probing operation's NC as a machine's probe writes it, and the lines a job needs to know. */
export type ProbeProgram = {
  /** Newline-terminated NC. */
  readonly nc: string
  /** One-based line of the block that probes, which reports what it measures; null for none. */
  readonly probeLine: number | null
  /** One-based line of the pause to review what was measured; null when the job does not pause. */
  readonly reviewLine: number | null
}

/** What every planned probing operation has: its parameters, checked, and where it starts. */
export type ProbingPlan<TParams> = {
  readonly params: TParams
  readonly start: ProbeStart
}

/**
 * What a machine's probe does for one probing operation: the ranges and defaults of the
 * operation's parameters (`parameters`), and the NC of a planned operation (`program`). Each
 * operation's plan says what else its NC needs.
 */
export interface Capability<
  TPlan,
  TSpecs extends ParameterSpecs = ParameterSpecs,
> {
  readonly parameters: TSpecs
  program: (plan: TPlan) => ProbeProgram
}

/** A rectangular grid of samples: its first sample, its extent and endpoint-inclusive counts. */
export type GridShape = Pick<
  ProbeGrid,
  "start" | "width" | "depth" | "columns" | "rows"
>

/**
 * A planned auto-level grid: its size, points and clearance and whether the job pauses to review
 * what it measured, checked, and where it starts.
 */
export type GridPlan = ProbingPlan<Omit<AutoLevelParams, "placement">>

/** How a machine probes a height grid, which auto-level compensates with. */
export interface GridProbing extends Capability<GridPlan, AutoLevelSpecs> {
  /** The NC probing a planned grid from its start; it always has the probing block. */
  program: (plan: GridPlan) => ProbeProgram & { readonly probeLine: number }
  /** A grid's samples, in the order the firmware visits them. */
  samples: (grid: GridShape) => ProbePoint[]
  /** The grids a program probes, as this machine's NC writes them: previews of any file. */
  grids: (program: GCodeProgram) => ProbeGrid[]
}

/**
 * How a machine touches off the stock top below a plan's start and sets work Z0 there. Its
 * program's probe line is the first touch; it never pauses for a review.
 */
export interface TouchOff extends Capability<
  ProbingPlan<Pick<AutoZHeightParams, AutoZHeightField>>,
  AutoZHeightSpecs
> {
  /**
   * The touch-offs a program makes where this machine's NC puts the probe, which its `grids`
   * may leave above their last sample: previews of any file.
   */
  touches: (program: GCodeProgram, grids: readonly ProbeGrid[]) => ProbeTouch[]
}

/**
 * A planned trace: its parameters, checked, and the outline it traces in work coordinates, rounded
 * outwards.
 */
export type TracePlan = {
  readonly params: AutoScanParams
  readonly outline: Rect<"work">
}

/**
 * How a machine traces an outline with a pointer, such as its probe's laser. Its program neither
 * probes nor reviews a measurement, so it has no probing or review line.
 */
export type OutlineTrace = Capability<TracePlan, AutoScanSpecs>

/** A planned 3D probing. */
export type OriginPlan = ProbingPlan<Probe3dParams> & {
  /** The work Z the probe comes down to over the start first; null when the placement has none. */
  readonly height: number | null
}

/**
 * How a machine finds a work origin with a 3D touch probe: it touches a corner of the stock or of
 * a pocket, or both sides of a pocket or boss, from the plan's start, and sets the work origin
 * there. Its program's probing block is the routine's, which reports each contact.
 */
export type OriginProbing = Capability<OriginPlan, Probe3dSpecs>

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

/**
 * What a probe does for each kind of probing, by the kind as combining knows it (`NcProbing`).
 * The probing operations plan in the machine's terms only through these: placement, anchors and
 * the stock are theirs; defaults, ranges and NC are the capability's.
 */
export type Capabilities = {
  readonly grid: GridProbing
  readonly "touch-off": TouchOff
  readonly outline: OutlineTrace
  readonly origin: OriginProbing
}

/** A kind of probing a probe may offer. */
export type CapabilityKind = keyof Capabilities

/**
 * A probe a machine measures with: the tool number its firmware selects it by, which a plate's
 * tool table holds a library probe in, its name in messages, and what the machine does with it.
 * A machine offers a probing operation only with a probe that offers its kind of probing: none
 * without a probe, no auto-scan without a pointer, no 3D probing without a 3D touch probe.
 */
export interface ProbeTool {
  readonly slot: number
  readonly name: string
  readonly capabilities: Partial<Capabilities>
}

/** A capability and the probe that offers it. */
export type Offered<TKind extends CapabilityKind> = {
  readonly probe: ProbeTool
  readonly capability: Capabilities[TKind]
}

/** The first of a machine's probes, in the kit's order, that offers a kind; null when none does. */
export function offering<TKind extends CapabilityKind>(
  probes: readonly ProbeTool[],
  kind: TKind
): Offered<TKind> | null {
  for (const probe of probes) {
    const capability: Capabilities[TKind] | undefined = probe.capabilities[kind]
    if (capability) return { probe, capability }
  }
  return null
}
