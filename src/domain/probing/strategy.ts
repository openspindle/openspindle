/**
 * Probing operations as a probe tool and a strategy: the user picks a probe from the tool library,
 * then one of the strategies it can run on the plate's machine, then that strategy's settings.
 * Generic strategies are OpenSpindle's own toolpaths, made of the machine's probing NC
 * (`MachineProbing.nc`); a machine adds strategies of its own for what its firmware does
 * (`MachineProbing.strategies`), listed besides them.
 */

import type { Issue } from "../diagnostics"
import type { GCodeProgram } from "../nc/gcode"
import type { ResolveContext } from "../operations/kinds"
import type { Plate } from "../plate/plate"
import type { ProbeProfile, Tool } from "../tools/tool"
import type { ParameterSpecs } from "./parameters"
import type { AnchorStart } from "./placement"
import type { ProbeGrid, ProbeTouch } from "./preview"
import type { CapabilityKind, ProbeProgram, ProbingSections } from "./probe"

/**
 * What a probing operation does, which decides its parameters: probe a height grid, touch off a
 * surface and set work Z there, trace an outline, or find a work origin.
 */
export type ProbingTask = CapabilityKind

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
  readonly context: ResolveContext
}

/**
 * A way to do a probing task: which probes can run it on a machine, the ranges and defaults of
 * the task's parameters with it, and its NC.
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
  /** Whether a probe with this profile can run it on the machine. */
  accepts: (probe: ProbeProfile, machine: MachineProbing) => boolean
  /** The task's parameters with it on the machine: their ranges and defaults. */
  parameters: (machine: MachineProbing) => TSpecs
  /** A new operation's parameters, fitted to the plate. */
  defaults: (plate: Plate, parameters: TSpecs) => TParams
  generate: (input: StrategyInput<TParams>) => Generation
}

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
 * How a machine probes: where its firmware needs each kind of probe, the NC generic strategies
 * are made of, the ranges they take on it, the strategies its firmware adds, and how its NC reads
 * as probing in any file.
 */
export interface MachineProbing {
  /** The T number the firmware needs a probe with this profile in; null where any number goes. */
  slot: (profile: ProbeProfile) => number | null
  readonly nc: ProbingNc
  /** The machine's ranges and defaults for the generic strategies, by strategy id. */
  readonly specs: Readonly<Record<string, ParameterSpecs>>
  /** Strategies of the machine's firmware, offered besides the generic ones. */
  readonly strategies: readonly ProbingStrategy[]
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
