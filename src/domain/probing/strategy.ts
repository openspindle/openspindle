/**
 * Probing operations as a probe tool and a strategy: the user picks a probe from the tool library,
 * then one of the strategies it can run on the plate's machine, then that strategy's settings.
 * Generic strategies are OpenSpindle's own toolpaths, made of the machine's probing NC
 * (`MachineProbing.nc`); a machine adds strategies of its own for what its firmware does
 * (`MachineProbing.strategies`), listed besides them.
 */

import type { PlateMachining } from "../compile/toolpath-bounds"
import type { Issue } from "../diagnostics"
import type { GCodeProgram } from "../nc/gcode"
import type { ProbingSource, ProbingSourceOf } from "../operations/operation"
import type { Plate } from "../plate/plate"
import type { ProbeProfile, Tool } from "../tools/tool"
import type { ParameterSpecs, SpecReads } from "./parameters"
import type { AnchorStart } from "./placement"
import type { ProbeGrid, ProbeTouch } from "./preview"
import type { ProbeProgram, ProbingSections } from "./probe"
import type { GenericSpecs } from "./generic/specs"
import type { GridSpecs } from "./tasks/grid/params"
import type { OriginSpecs } from "./tasks/origin/params"
import type { OutlineSpecs } from "./tasks/outline/params"
import type { TouchOffSpecs } from "./tasks/touch-off/params"

/**
 * What a probing operation does, which decides its parameters: probe a height grid, touch off a
 * surface and set work Z there, trace an outline, or find a work origin.
 */
export type ProbingTask = ProbingSource["task"]

/** A task's parameters, as its operations store them. */
export type TaskParams<TTask extends ProbingTask> =
  ProbingSourceOf<TTask>["params"]

/** The ranges and defaults a strategy gives a task's numeric parameters. */
export type TaskSpecs = {
  readonly grid: GridSpecs
  readonly "touch-off": TouchOffSpecs
  readonly outline: OutlineSpecs
  readonly origin: OriginSpecs
}

/** The probe an operation selects: the T number its NC selects and the library probe bound there. */
export type BoundProbe = {
  readonly number: number
  readonly tool: Tool
  readonly profile: ProbeProfile
}

/** A strategy's NC for a planned operation, or why there is none. */
export type Generation =
  | { readonly ok: true; readonly program: ProbeProgram }
  | { readonly ok: false; readonly issues: readonly Issue[] }

/** What a strategy writes its NC from. */
export type StrategyInput<TParams> = {
  readonly params: TParams
  readonly plate: Plate
  readonly probe: BoundProbe
  readonly machine: MachineProbing
  /** Where the plate's other operations cut, measured only if the strategy reads it. */
  readonly machining: PlateMachining
}

/**
 * A way to do a probing task: which machines run it, which probes it probes with, the ranges and
 * defaults of the task's parameters with it, and its NC.
 */
export interface ProbingStrategy<
  TTask extends ProbingTask = ProbingTask,
  TParams = unknown,
  TSpecs extends ParameterSpecs = ParameterSpecs,
> {
  /** Stored in the operation: generic strategies' ids are plain, a machine's are prefixed. */
  readonly id: string
  readonly task: TTask
  readonly label: string
  readonly description: string
  /**
   * Whether a machine runs it, whatever the probe: a generic strategy needs the machine's ranges
   * for it and the NC it is made of. Absent for a machine's own strategies, which it runs.
   */
  runsOn?: (machine: MachineProbing) => boolean
  /**
   * Whether it can probe with a probe of this profile: what the probe must sense or carry for
   * it. Whether the machine's firmware lets that probe do the task is the machine's to say
   * (`MachineProbing.probes`).
   */
  accepts: (probe: ProbeProfile, machine: MachineProbing) => boolean
  /**
   * Why it cannot probe with a probe tool it accepts, such as a ball it does not take, naming the
   * tool and `number`, the plate's table entry that holds it; null where it can. Assigning another
   * tool there, or correcting this one in the tool library, fixes it.
   */
  refuses?: (tool: Tool, number: number | null) => string | null
  /**
   * Why it cannot run on this plate, whatever its settings, as picking it shows; null where it
   * can. Not a rule: generating its NC still fails on its own where it cannot.
   */
  blocked?: (plate: Plate, machine: MachineProbing) => string | null
  /** The task's parameters with it on the machine: their ranges and defaults. */
  parameters: (machine: MachineProbing) => TSpecs
  /**
   * Which of those parameters it reads with an operation's parameters, so that its form leaves
   * out the others; absent, it reads them all.
   */
  reads?: (params: TParams) => SpecReads<TSpecs>
  /** A new operation's parameters, fitted to the plate and where it cuts. */
  defaults: (
    plate: Plate,
    parameters: TSpecs,
    machining: PlateMachining
  ) => TParams
  generate: (input: StrategyInput<TParams>) => Generation
}

/**
 * A strategy of one of `TTask`, with that task's parameters and specs: what registries hold, as
 * a strategy of one task's parameters is no strategy of any parameters. Its `task` tells which.
 */
export type TaskStrategy<TTask extends ProbingTask = ProbingTask> = {
  [TKey in TTask]: ProbingStrategy<TKey, TaskParams<TKey>, TaskSpecs[TKey]>
}[TTask]

/**
 * The machine's NC that generic strategies are made of: readying a probe, its pointer and
 * indicator, travel to an anchored start, and the touch motion its firmware configures.
 */
export type ProbingNc = {
  /** Before a probe probes: the spindle stopped, millimetres and absolute distances, its tool change. */
  select: (probe: BoundProbe) => readonly string[]
  /** Switches the probe's pointer on; null for a machine that has none to switch. */
  readonly pointer: { readonly on: readonly string[] } | null
  /** Shows that the probe is about to touch, and that it has; empty where nothing shows it. */
  readonly indicator: {
    readonly touching: readonly string[]
    readonly touched: readonly string[]
  }
  /** Travel to an anchored start in machine coordinates, at the height the probe travels at. */
  travel: (start: AnchorStart) => readonly string[]
  /** A touch-off's fast and slow feeds (mm/min) and the back-off between them (mm). */
  readonly touch: {
    readonly fastFeed: number
    readonly slowFeed: number
    readonly backOff: number
  }
}

/**
 * How a machine probes: which probes its firmware lets do which task and in which T number, the
 * NC generic strategies are made of, the ranges they take on it, the strategies its firmware
 * adds, and how its NC reads as probing in any file.
 */
export interface MachineProbing {
  /** Whether its firmware lets a probe with this profile do the task, whatever the strategy. */
  probes: (task: ProbingTask, profile: ProbeProfile) => boolean
  /** The T number the firmware needs a probe with this profile in; null where any number goes. */
  slot: (profile: ProbeProfile) => number | null
  readonly nc: ProbingNc
  /** The machine's ranges and defaults for the generic strategies it runs, by strategy id. */
  readonly specs: Partial<GenericSpecs>
  /** Strategies of the machine's firmware, offered besides the generic ones. */
  readonly strategies: readonly TaskStrategy[]
  /** How its NC reads as probing in a program's sections. */
  readonly sections: ProbingSections
  /** Where any NC file probes, as the machine's firmware reads it: previews. */
  readonly readers: {
    grids: (program: GCodeProgram) => ProbeGrid<"probe" | "machine">[]
    touches: (
      program: GCodeProgram,
      grids: readonly ProbeGrid<"probe" | "machine">[]
    ) => ProbeTouch<"probe" | "machine">[]
  }
}
