import type { NcBlock } from "@/machine/contract"
import type { GCodeProgram } from "@/domain/nc/gcode"
import type {
  AutoLevelGridField,
  AutoLevelGridParameters,
  AutoLevelParams,
} from "../auto-level/params"
import type { ProbeGrid, ProbePoint } from "../auto-level/probe-grid"
import type { ProbeStart } from "../auto-level/rules"
import type { AutoScanParameters, AutoScanParams } from "../auto-scan/params"
import type {
  AutoZHeightParameters,
  AutoZHeightParams,
} from "../auto-z-height/params"
import type { ProbeTouch } from "../auto-z-height/probe-touch"
import type { TouchOffStart } from "../auto-z-height/rules"
import type { ToolpathBounds } from "../compile/cutting-bounds"
import type { Probe3dParameters, Probe3dParams } from "../probe-3d/params"

/** A rectangular grid of samples: its first sample, its extent and endpoint-inclusive counts. */
export type GridShape = Pick<
  ProbeGrid,
  "start" | "width" | "depth" | "columns" | "rows"
>

/** Grid probing NC, with the lines of its probing block and of its review pause, if any. */
export type GridProgram = {
  /** Newline-terminated NC. */
  nc: string
  /** One-based line of the block that probes the grid. */
  probeLine: number
  /** One-based line of the pause after probing; null when the job does not pause there. */
  reviewPauseLine: number | null
}

/** How a machine probes a height grid, which auto-level compensates with. */
export interface GridProbing {
  /** The grid's parameters: defaults, and the ranges the machine accepts. */
  readonly parameters: AutoLevelGridParameters
  /** A grid's samples, in the order the firmware visits them. */
  samples: (grid: GridShape) => ProbePoint[]
  /** The NC probing a planned grid from its start. */
  program: (
    size: Pick<AutoLevelParams, AutoLevelGridField>,
    start: ProbeStart,
    reviewAfterProbe: boolean
  ) => GridProgram
  /** The grids a program probes, as this machine's NC writes them: previews of any file. */
  grids: (program: GCodeProgram) => ProbeGrid[]
}

/** How a machine touches off the stock top and sets work Z there. */
export interface TouchOff {
  readonly parameters: AutoZHeightParameters
  /** The NC touching off below its start and setting work Z0 there. */
  program: (
    touch: Pick<AutoZHeightParams, "probeTravel" | "clearance">,
    start: TouchOffStart
  ) => string
  /**
   * The touch-offs a program makes where this machine's NC puts the probe, which its `grids`
   * may leave above their last sample: previews of any file.
   */
  touches: (program: GCodeProgram, grids: readonly ProbeGrid[]) => ProbeTouch[]
}

/** How a machine traces an outline with a pointer, such as its probe's laser. */
export interface OutlineTrace {
  readonly parameters: AutoScanParameters
  /** The NC tracing an outline in work coordinates, already rounded outwards. */
  program: (params: AutoScanParams, outline: ToolpathBounds) => string
}

/**
 * How a machine finds a work origin with a 3D touch probe: it touches a corner of the stock or of
 * a pocket, or both sides of a pocket or boss, and sets the work origin there.
 */
export interface OriginProbing {
  readonly parameters: Probe3dParameters
  /**
   * The NC finding the corner or centre from its start and setting the work origin there;
   * `height` is the work Z the probe comes down to over the start first, if any.
   */
  program: (
    params: Probe3dParams,
    start: TouchOffStart,
    height: number | null
  ) => string
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

/**
 * A machine's probe, as its firmware measures with it. The probing operations plan in the
 * machine's terms only through it: placement, anchors and the stock are theirs; defaults,
 * ranges and NC are the probe's. A machine without one offers no probing operations, one
 * without a pointer offers no auto-scan, and one without a 3D touch probe no 3D probing.
 */
export interface Probe {
  readonly autoLevel: GridProbing
  readonly autoZHeight: TouchOff
  readonly autoScan: OutlineTrace | null
  readonly probe3d: OriginProbing | null
  readonly sections: ProbingSections
}
