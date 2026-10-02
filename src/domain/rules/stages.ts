import type {
  AnchorConfiguration,
  CommandStage,
  Rule,
  RuleResult,
} from "@/machine/contract"
import type { CompiledPlate } from "../compile/compile"
import type { MachineEvidence } from "../diagnosis/evidence"
import type { Resolution } from "../diagnosis/resolution"
import { FRESH_START } from "../design-rules/program-rules"
import type { ProgramStart } from "../design-rules/program-rules"
import type { Place, QuickFix, Subject } from "../diagnostics"
import type { FixtureKit } from "../fixtures/fixture-kit"
import type { GCodeSegment } from "../nc/gcode"
import { programLines } from "../nc/program-lines"
import type { ProgramLines } from "../nc/program-lines"
import type { Operation } from "../operations/operation"
import type { Plate, PlateTool } from "../plate/plate"
import type {
  GridSize,
  HeightOutlier,
  SurfaceFit,
} from "../probing/tasks/grid/analysis"
import type { Tool } from "../tools/tool"

/** What a failure is about, and where on the bed, for views that list it as a diagnostic. */
export type DiagnosticDetails = {
  readonly about?: Subject
  readonly places?: readonly Place[]
}

/** A stage whose failures are listed as diagnostics, with a quick fix. */
type DiagnosticStage<TSubject> = {
  readonly subject: TSubject
  readonly fix: QuickFix
  readonly details: DiagnosticDetails
}

/** NC as written, with what runs before it: an operation's own NC, a program to import, a console line. */
export type ProgramSubject = {
  readonly program: ProgramLines
  readonly start: ProgramStart
}

/** A change a program rule makes to a program; lines keep their numbers. */
export type ProgramFix = {
  readonly resolution: "drop" | "replace"
  readonly label: string
  readonly description: string
}

/** One move of a plate's compiled program that reaches below the stock top over its footprint (without stock, below Z0 over the cuts), as the design rule check walks them. */
export type MoveSubject = {
  readonly segment: GCodeSegment
  /** The operation whose lines it is on; null for the program's own lines. */
  readonly operationId: string | null
  /** A feed move that cuts: not rapid, and not the probe's (T0, the 3D probe's slot). */
  readonly cutting: boolean
  /** How fast it goes down, mm/min: a straight plunge at its feed, a ramp at part of it; 0 when it does not. */
  readonly plungeRate: number
  /** How far below the stock top (without stock, Z0) it reaches. */
  readonly depth: number
  /** How far below the stock bottom it reaches; null without stock. */
  readonly under: number | null
}

/** One entry of a plate's tool table, with the library tool it names; null where the library has none. */
export type ToolRuleSubject = {
  readonly entry: PlateTool
  readonly tool: Tool | null
}

/** One operation of a plate, with its machine's kit and the compiled program. */
export type OperationRuleSubject = {
  readonly operation: Operation
  readonly plate: Plate
  readonly kit: FixtureKit
  readonly compiled: CompiledPlate
}

/** The connected machine, as far as running a plate depends on it. */
export type ConnectedMachine = {
  readonly connectedDeviceId: string | null
  readonly anchors: AnchorConfiguration | null
}

/** Before Run: the plate to run (null without one), or one of its operations, against the connected machine. */
export type RunRuleSubject = {
  readonly plate: Plate | null
  readonly operation: Operation | null
  readonly machine: ConnectedMachine
}

/** A height map read after probing, as its review measures it. */
export type HeightMapSubject = {
  readonly size: GridSize
  readonly expected: GridSize | null
  readonly total: number
  readonly measured: number
  readonly missing: number
  readonly outliers: readonly HeightOutlier[]
  /** Null with too few heights to fit a plane. */
  readonly surface: SurfaceFit | null
  /** The largest deviation from a plane still called flat, mm. */
  readonly tolerance: number
}

/** Every stage's subject, fixes and failure details. */
export type RuleStages = {
  readonly command: CommandStage
  readonly program: {
    readonly subject: ProgramSubject
    readonly fix: ProgramFix
    readonly details: object
  }
  readonly move: {
    readonly subject: MoveSubject
    readonly fix: never
    readonly details: object
  }
  readonly tool: DiagnosticStage<ToolRuleSubject>
  readonly operation: DiagnosticStage<OperationRuleSubject>
  readonly run: DiagnosticStage<RunRuleSubject>
  readonly "height-map": {
    readonly subject: HeightMapSubject
    readonly fix: never
    readonly details: object
  }
  /**
   * What is known about the connected machine. A failure is a finding, which its rule's label
   * names unless its `title` names it otherwise, such as an alarm by its code.
   */
  readonly diagnosis: {
    readonly subject: MachineEvidence
    readonly fix: Resolution
    readonly details: { readonly title?: string }
  }
}
export type StageName = keyof RuleStages
export type StageRule<TName extends StageName> = Rule<TName, RuleStages[TName]>
export type StageFailure<TName extends StageName> = RuleResult<
  TName,
  RuleStages[TName]
>
/** A rule of any stage: what the one list holds. */
export type AnyRule = { [TName in StageName]: StageRule<TName> }[StageName]

/** NC text as the program rules test it, from its start. */
export function programSubject(
  text: string,
  start: ProgramStart = FRESH_START
): ProgramSubject {
  return { program: programLines(text), start }
}

/** The subjects Run's rules test: the plate (or none), then each of its operations. */
export function runSubjects(
  plate: Plate | null,
  machine: ConnectedMachine
): RunRuleSubject[] {
  return [
    { plate, operation: null, machine },
    ...(plate?.operations ?? []).map((operation) => ({
      plate,
      operation,
      machine,
    })),
  ]
}
