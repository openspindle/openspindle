import type { AnchorConfiguration } from "@/machine/contract"
import type { NcPolicy } from "../compile/nc-unit"
import { plateMachining } from "../compile/toolpath-bounds"
import { error, operationSubject } from "../diagnostics"
import type { Diagnostic, Issue, QuickFix } from "../diagnostics"
import { kitForPlate } from "../fixtures/catalog"
import type { FixtureKit } from "../fixtures/fixture-kit"
import type { Plate } from "../plate/plate"
import { fail, ok } from "../primitives"
import type { Result } from "../primitives"
import { boundProbe } from "../probing/bound-probe"
import { placementContext } from "../probing/placement"
import {
  generateProbing,
  strategyFor,
  strategyLabel,
} from "../probing/strategies"
import type { ProbingTask, TaskSpecs } from "../probing/strategy"
import type { GridIssueCode } from "../probing/tasks/grid/issues"
import { gridRunIssues, validateGrid } from "../probing/tasks/grid/rules"
import {
  originOrderIssues,
  validateOrigin,
} from "../probing/tasks/origin/rules"
import type { OriginIssueCode } from "../probing/tasks/origin/rules"
import {
  outlineOrderIssues,
  outlineStockIssues,
} from "../probing/tasks/outline/rules"
import {
  gridOrderIssues,
  validateTouchOff,
} from "../probing/tasks/touch-off/rules"
import type {
  LaterGrid,
  TouchOffIssueCode,
} from "../probing/tasks/touch-off/rules"
import type { Tool } from "../tools/tool"
import { fileKind, pluginKind, templateKind } from "./kept-nc"
import type {
  Operation,
  Phase,
  ProbingSourceOf,
  SourceKind,
  SourceOf,
} from "./operation"

/** The NC an operation contributes and what that NC may contain. */
export type ResolvedNc = {
  readonly nc: string
  readonly policy: NcPolicy
  /** 1-based lines of `nc` where the program pauses for a review. */
  readonly reviewLines: readonly number[]
}

export type OperationOf<TKind extends SourceKind> = Operation & {
  source: SourceOf<TKind>
}

/** A probing operation doing `TTask`. */
export type ProbingOperation<TTask extends ProbingTask = ProbingTask> =
  Operation & { source: ProbingSourceOf<TTask> }

/**
 * What resolving an operation reads besides the operation and its plate: the kit of the plate's
 * machine, and the library `tools` that the plate's tool table refers to.
 */
export type ResolveContext = {
  readonly kit: FixtureKit
  readonly tools: readonly Tool[]
}

// Files and plugins resolve with the kit alone (`keptNcContext`), as design rules read them too.
export { keptNcContext } from "./kept-nc"

/** The connected machine, as far as running an operation depends on it. */
export type RunContext = {
  readonly connectedDeviceId: string | null
  /** Stored anchors from the connected device's latest successful read. */
  readonly anchors: AnchorConfiguration | null
}

/**
 * Strategy per operation source kind: how it becomes NC, its phase, whether a lone
 * operation may be emitted byte-for-byte, and what to check while editing and before Run.
 * New kinds register here; nothing else switches on plugin ids. Kinds resolve and validate with
 * the kit of the plate's machine (`kitForPlate`), and resolve with the tool library too
 * (`ResolveContext`): a probing operation's strategy writes its NC on the machine with the probe
 * the plate's table holds for it.
 */
export interface OperationKind<TKind extends SourceKind> {
  readonly kind: TKind
  readonly label: string
  readonly verbatim: boolean
  /**
   * Its NC is generated from its parameters and the plate rather than kept: what a saved
   * project attaches documents the NC when it was saved, and opening generates it anew.
   */
  readonly generated: boolean
  phase: (operation: OperationOf<TKind>) => Phase
  /**
   * The tool numbers its NC selects, known without resolving it; absent where only the NC says
   * (`localTools`). Binding keeps them while the NC does not resolve, as a probing operation's
   * does until its probe is in the plate's table.
   */
  tools?: (operation: OperationOf<TKind>) => readonly (number | null)[]
  resolve: (
    operation: OperationOf<TKind>,
    plate: Plate,
    context: ResolveContext
  ) => Result<ResolvedNc, Diagnostic>
  /** Advice about an operation whose NC resolves; errors block Run. */
  validate?: (
    operation: OperationOf<TKind>,
    plate: Plate,
    kit: FixtureKit
  ) => Diagnostic[]
  /** What blocks running the operation on the connected machine. */
  runChecks?: (
    operation: OperationOf<TKind>,
    plate: Plate,
    machine: RunContext
  ) => Diagnostic[]
}

/**
 * A probing operation on a machine that does not probe, or whose strategy the plate's machine
 * does not offer for its task, named by its label (`strategyLabel`). The operation's inspector
 * shows it; its editor has no settings to add.
 */
const unsupported = (
  operation: ProbingOperation,
  kit: FixtureKit
): Diagnostic =>
  error(
    "probing-unsupported",
    kit.probing
      ? `${operation.name}: the ${kit.name} does not offer ${strategyLabel(operation.source.strategy)} for this operation.`
      : `${operation.name}: the ${kit.name} does not probe.`,
    { subject: operationSubject(operation.id) }
  )

/** Issues that block generating the NC; the compiler reports those already. */
const GENERATION_BLOCKERS: ReadonlySet<GridIssueCode> = new Set([
  "invalid-parameters",
  "anchor-snapshot-missing",
  "anchor-unavailable",
  "anchor-grid-out-of-range",
])

const ANCHOR_READS: ReadonlySet<string> = new Set([
  "anchors-not-read",
  "live-anchors-unavailable",
  "anchors-changed",
])

/**
 * The kinds probing operations had before strategies, by task: their diagnostics' codes still
 * start with them (`auto-level/grid-exceeds-stock`, `auto-level-invalid`) until the rules step
 * renames them.
 */
const LEGACY_KINDS: { readonly [TTask in ProbingTask]: string } = {
  grid: "auto-level",
  "touch-off": "auto-z-height",
  outline: "auto-scan",
  origin: "probe-3d",
}

/**
 * A probing task's issue as the operation's diagnostic: its code namespaced by the task's legacy
 * kind (`auto-level/grid-exceeds-stock`), and where it is, as the issue says.
 */
function issueDiagnostic(
  task: ProbingTask,
  issue: Issue,
  operation: Operation
): Diagnostic {
  const fix: QuickFix = ANCHOR_READS.has(issue.code)
    ? { kind: "read-anchors" }
    : { kind: "edit-operation", operationId: operation.id }
  return {
    ...issue,
    code: `${LEGACY_KINDS[task]}/${issue.code}`,
    subject: operationSubject(operation.id),
    fix,
  }
}

/**
 * The ranges the operation's strategy gives its parameters on the plate's machine; null where
 * the machine has no such strategy.
 */
function specsFor<TTask extends ProbingTask>(
  source: ProbingSourceOf<TTask>,
  kit: FixtureKit
): TaskSpecs[TTask] | null {
  const machine = kit.probing
  const strategy = machine && strategyFor(source, machine)
  return machine && strategy ? strategy.parameters(machine) : null
}

/** What sets a probing task's operations apart beyond their strategy: their diagnostics. */
type TaskDiagnostics<TTask extends ProbingTask> = {
  /** Why generating failed, as `<legacy kind>-invalid` says when no issue does. */
  readonly invalid: string
  readonly validate?: (
    operation: ProbingOperation<TTask>,
    plate: Plate,
    kit: FixtureKit
  ) => Diagnostic[]
  readonly runChecks?: (
    operation: ProbingOperation<TTask>,
    plate: Plate,
    machine: RunContext
  ) => Diagnostic[]
}

/** Whether an anchored probing may run on the connected machine (`gridRunIssues`). */
const anchoredRunChecks =
  (task: ProbingTask) =>
  (
    operation: ProbingOperation<"grid" | "touch-off" | "origin">,
    plate: Plate,
    machine: RunContext
  ) =>
    gridRunIssues(
      operation.source.params,
      placementContext(plate),
      machine
    ).map((issue) => issueDiagnostic(task, issue, operation))

/** Issues that block generating the touch-off NC; the compiler reports those already. */
const TOUCH_OFF_BLOCKERS: ReadonlySet<TouchOffIssueCode> = new Set([
  "invalid-parameters",
  "anchor-snapshot-missing",
  "anchor-unavailable",
  "anchor-point-out-of-range",
])

/** The grids after an operation, which measure their heights from their own start. */
function laterGrids(plate: Plate, operation: Operation): LaterGrid[] {
  const index = plate.operations.findIndex((item) => item.id === operation.id)
  if (index < 0) return []
  return plate.operations.slice(index + 1).flatMap((later, offset) =>
    later.source.kind === "probing" && later.source.task === "grid"
      ? [
          {
            placement: later.source.params.placement,
            adjacent: offset === 0 && !later.stopBefore,
          },
        ]
      : []
  )
}

/** Issues that block generating the 3D probing NC; the compiler reports those already. */
const PROBE_3D_BLOCKERS: ReadonlySet<OriginIssueCode> = new Set([
  "invalid-parameters",
  "anchor-snapshot-missing",
  "anchor-unavailable",
  "anchor-point-out-of-range",
])

/**
 * Each task's diagnostics, as its kind had them before strategies: advice within the ranges the
 * operation's strategy gives on the machine (none without the strategy), and run checks.
 */
const TASK_DIAGNOSTICS: {
  readonly [TTask in ProbingTask]: TaskDiagnostics<TTask>
} = {
  grid: {
    invalid: "the probe grid is invalid.",
    validate: (operation, plate, kit) => {
      const specs = specsFor(operation.source, kit)
      if (!specs) return []
      return validateGrid(
        operation.source.params,
        {
          ...placementContext(plate),
          stock: plate.setup.stock,
          stockAnchor: plate.setup.stockAnchor,
        },
        specs
      )
        .filter((issue) => !GENERATION_BLOCKERS.has(issue.code))
        .map((issue) => issueDiagnostic("grid", issue, operation))
    },
    runChecks: anchoredRunChecks("grid"),
  },
  "touch-off": {
    invalid: "the touch-off is invalid.",
    validate: (operation, plate, kit) => {
      const specs = specsFor(operation.source, kit)
      if (!specs) return []
      return [
        ...validateTouchOff(
          operation.source.params,
          {
            ...placementContext(plate),
            stock: plate.setup.stock,
            stockAnchor: plate.setup.stockAnchor,
          },
          specs
        ).filter((issue) => !TOUCH_OFF_BLOCKERS.has(issue.code)),
        ...gridOrderIssues(
          operation.source.params,
          laterGrids(plate, operation)
        ),
      ].map((issue) => issueDiagnostic("touch-off", issue, operation))
    },
    runChecks: anchoredRunChecks("touch-off"),
  },
  outline: {
    invalid: "the scan is invalid.",
    // Outline and order advice needs no strategy, so a machine without one still reports it.
    validate: (operation, plate, kit) => {
      const toolpath = plateMachining(plate, kit).toolpath()
      const index = plate.operations.findIndex(
        (item) => item.id === operation.id
      )
      const machiningBefore = plate.operations
        .slice(0, Math.max(0, index))
        .some((item) => operationPhase(item) !== "setup")
      return [
        ...(toolpath.ok
          ? outlineStockIssues(toolpath.bounds, plate.setup)
          : []),
        ...outlineOrderIssues(machiningBefore),
      ].map((issue) => issueDiagnostic("outline", issue, operation))
    },
  },
  origin: {
    invalid: "the probing is invalid.",
    validate: (operation, plate, kit) => {
      const specs = specsFor(operation.source, kit)
      if (!specs) return []
      const { params } = operation.source
      return [
        ...validateOrigin(params, placementContext(plate), specs).filter(
          (issue) => !PROBE_3D_BLOCKERS.has(issue.code)
        ),
        ...originOrderIssues(params, laterGrids(plate, operation)),
      ].map((issue) => issueDiagnostic("origin", issue, operation))
    },
    runChecks: anchoredRunChecks("origin"),
  },
}

/**
 * The diagnostics of a probing operation's task. The table pairs each task with its own
 * operations; TypeScript cannot correlate the union on its own, so this one cast states it.
 */
const taskDiagnostics = (operation: ProbingOperation) =>
  TASK_DIAGNOSTICS[operation.source.task] as TaskDiagnostics<ProbingTask>

/**
 * Probing operations: a setup operation whose NC its strategy writes, and is kept verbatim, on
 * the plate's machine with the probe the plate's table holds in the number the operation
 * selects. Without the strategy it does not resolve (`probing-unsupported`), nor without a probe
 * the strategy runs with there (`probing-probe`); an operation whose NC the strategy does not
 * generate reports its first issue as `<legacy kind>-invalid`.
 */
const probingKind: OperationKind<"probing"> = {
  kind: "probing",
  label: "Probing",
  verbatim: true,
  generated: true,
  phase: () => "setup",
  tools: ({ source }) => [source.probe],
  resolve: (operation, plate, context) => {
    const { source } = operation
    const { kit } = context
    const machine = kit.probing
    const strategy = machine && strategyFor(source, machine)
    if (!machine || !strategy) return fail(unsupported(operation, kit))
    const subject = operationSubject(operation.id)
    const edit: QuickFix = { kind: "edit-operation", operationId: operation.id }
    const probe = boundProbe(
      operation,
      plate,
      context.tools,
      strategy,
      machine,
      kit.name
    )
    if (!probe.ok) {
      const { message, toolNumber } = probe.error
      return fail(
        error("probing-probe", `${operation.name}: ${message}`, {
          subject,
          fix:
            toolNumber === undefined
              ? edit
              : { kind: "assign-tool", toolNumber },
        })
      )
    }
    const generated = generateProbing(strategy, source, {
      plate,
      probe: probe.value,
      machine,
      context,
      machining: plateMachining(plate, kit),
    })
    if (!generated?.ok)
      return fail(
        error(
          `${LEGACY_KINDS[source.task]}-invalid`,
          `${operation.name}: ${generated?.issues.at(0)?.message ?? taskDiagnostics(operation).invalid}`,
          { subject, fix: edit }
        )
      )
    const { nc, reviewLine } = generated.program
    return ok({
      nc,
      policy: {
        probing: source.task,
        // Only a grid clears earlier height compensation before it travels to its anchor.
        anchoredProbing:
          source.task === "grid" && source.params.placement.kind === "anchor",
      },
      reviewLines: reviewLine === null ? [] : [reviewLine],
    })
  },
  validate: (operation, plate, kit) =>
    taskDiagnostics(operation).validate?.(operation, plate, kit) ?? [],
  runChecks: (operation, plate, machine) =>
    taskDiagnostics(operation).runChecks?.(operation, plate, machine) ?? [],
}

export const OPERATION_KINDS: {
  readonly [TKind in SourceKind]: OperationKind<TKind>
} = {
  file: fileKind,
  template: templateKind,
  plugin: pluginKind,
  probing: probingKind,
}

/**
 * The registry pairs each kind with its own source type; TypeScript cannot correlate the
 * union on its own, so this one cast is where that guarantee is stated.
 */
export function kindOf(operation: Operation): OperationKind<SourceKind> {
  return OPERATION_KINDS[
    operation.source.kind
  ] as unknown as OperationKind<SourceKind>
}

/** The NC an operation contributes, resolved with its plate's machine and the tool library. */
export const resolveOperation = (
  operation: Operation,
  plate: Plate,
  context: ResolveContext
) => kindOf(operation).resolve(operation, plate, context)

export const operationPhase = (operation: Operation): Phase =>
  kindOf(operation).phase(operation)

/** Advice about every operation of a plate (see OperationKind.validate). */
export const validateOperations = (
  plate: Plate,
  kit: FixtureKit = kitForPlate(plate)
): Diagnostic[] =>
  plate.operations.flatMap(
    (operation) => kindOf(operation).validate?.(operation, plate, kit) ?? []
  )

/** What blocks running a plate's operations on the connected machine. */
export const runChecks = (plate: Plate, machine: RunContext): Diagnostic[] =>
  plate.operations.flatMap(
    (operation) =>
      kindOf(operation).runChecks?.(operation, plate, machine) ?? []
  )
