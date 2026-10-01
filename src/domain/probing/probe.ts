import type { NcBlock } from "@/machine/contract"
import type { GCodeProgram } from "@/domain/nc/gcode"
import type { GridSpecs, GridParams } from "./tasks/grid/params"
import type { OutlineParams, OutlineSpecs } from "./tasks/outline/params"
import type {
  TouchOffField,
  TouchOffSpecs,
  TouchOffParams,
} from "./tasks/touch-off/params"
import type { Rect } from "../geometry/rect"
import type { OriginSpecs, OriginParams } from "./tasks/origin/params"
import type { ParameterSpecs } from "./parameters"
import type { ProbeStart } from "./placement"
import type { ProbeGrid, ProbeTouch } from "./preview"

/** A probing operation's NC as a machine's probe writes it, and where a job pauses in it. */
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

/**
 * A planned auto-level grid: its size, points and clearance and whether the job pauses to review
 * what it measured, checked, and where it starts.
 */
export type GridPlan = ProbingPlan<Omit<GridParams, "placement">>

/** How a machine probes a height grid, which auto-level compensates with. */
export interface GridProbing extends Capability<GridPlan, GridSpecs> {
  /**
   * The grids a program probes, as this machine's NC writes them: previews of any file, from
   * where the probe starts or in machine coordinates.
   */
  grids: (program: GCodeProgram) => ProbeGrid<"probe" | "machine">[]
}

/**
 * How a machine touches off the stock top below a plan's start and sets work Z0 there. Its
 * program never pauses for a review.
 */
export interface TouchOff extends Capability<
  ProbingPlan<Pick<TouchOffParams, TouchOffField>>,
  TouchOffSpecs
> {
  /**
   * The touch-offs a program makes where this machine's NC puts the probe, which its `grids`
   * may leave above their last sample: previews of any file.
   */
  touches: (
    program: GCodeProgram,
    grids: readonly ProbeGrid<"probe" | "machine">[]
  ) => ProbeTouch<"probe" | "machine">[]
}

/**
 * A planned trace: its parameters, checked, and the outline it traces in work coordinates, rounded
 * outwards.
 */
export type TracePlan = {
  readonly params: OutlineParams
  readonly outline: Rect<"work">
}

/**
 * How a machine traces an outline with a pointer, such as its probe's laser. Its program neither
 * probes nor reviews a measurement, so it has no review line.
 */
export type OutlineTrace = Capability<TracePlan, OutlineSpecs>

/** A planned 3D probing. */
export type OriginPlan = ProbingPlan<OriginParams> & {
  /** The work Z the probe comes down to over the start first; null when the placement has none. */
  readonly height: number | null
}

/**
 * How a machine finds a work origin with a 3D touch probe: it touches a corner of the stock or of
 * a pocket, or both sides of a pocket or boss, from the plan's start, and sets the work origin
 * there. Its program's probing block is the routine's, which reports each contact.
 */
export type OriginProbing = Capability<OriginPlan, OriginSpecs>

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
