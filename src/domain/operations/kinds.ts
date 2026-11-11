import type { NcPolicy } from "../compile/nc-unit"
import { plateMachining } from "../compile/toolpath-bounds"
import { error, operationSubject } from "../diagnostics"
import type { Diagnostic, QuickFix } from "../diagnostics"
import type { FixtureKit } from "../fixtures/fixture-kit"
import type { Plate } from "../plate/plate"
import { fail, ok } from "../primitives"
import type { Result } from "../primitives"
import { boundProbe } from "../probing/bound-probe"
import {
  generateProbing,
  methodFor,
  strategyById,
  strategyLabel,
} from "../probing/strategies"
import type { ProbingTask } from "../probing/strategy"
import type { Tool } from "../tools/tool"
import { fileKind, pcbKind, unsupportedKind } from "./kept-nc"
import { facingKind } from "./facing-kind"
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

// Files and PCB resolve with the kit alone (`keptNcContext`), as design rules read them too.
export { keptNcContext } from "./kept-nc"

/**
 * Strategy per operation source kind: how it becomes NC, its phase, and whether a lone
 * operation may be emitted byte-for-byte. New kinds register here. Kinds resolve with the kit
 * of the plate's machine (`kitForPlate`) and the tool library (`ResolveContext`): a probing
 * operation's method writes its NC on the machine with the probe the plate's table holds for
 * it. The operation and run rules check an operation while editing and before Run.
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
}

/**
 * A probing operation on a machine that does not probe, or does not support its strategy (has no
 * method for it), named by its label (`strategyLabel`): also a strategy OpenSpindle does not
 * know, by its id, or one of another task than the operation's. The operation's inspector shows
 * it; its editor has no settings to add.
 */
function unsupported(operation: ProbingOperation, kit: FixtureKit): Diagnostic {
  const { name, source } = operation
  const label = strategyLabel(source.strategy)
  const strategy = strategyById(source.strategy)
  const otherTask = strategy !== null && strategy.task !== source.task
  let message = `${name}: the ${kit.name} does not probe.`
  if (kit.probing && otherTask)
    message = `${name}: the ${kit.name} does not support ${label} for this operation.`
  else if (kit.probing)
    message = `${name}: the ${kit.name} does not support ${label}.`
  return error("probing-unsupported", message, {
    subject: operationSubject(operation.id),
  })
}

/** Why a task's NC was not generated, where its method gives no reason. */
const INVALID: { readonly [TTask in ProbingTask]: string } = {
  grid: "the probe grid is invalid.",
  "touch-off": "the touch-off is invalid.",
  outline: "the trace is invalid.",
  origin: "the probing is invalid.",
}

/**
 * Probing operations: a setup operation whose NC the method that performs its strategy on the
 * plate's machine writes (`methodFor`), and is kept verbatim, with the probe the plate's table
 * holds in the number the operation selects. Without such a method it does not resolve
 * (`probing-unsupported`), nor without a probe the method runs with there (`probing-probe`, also
 * where the method refuses that tool); an operation whose NC the method does not generate reports
 * its first issue (`probing-invalid`).
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
    const method = machine && methodFor(source, machine, plate)
    if (!machine || !method) return fail(unsupported(operation, kit))
    const subject = operationSubject(operation.id)
    const edit: QuickFix = { kind: "edit-operation", operationId: operation.id }
    const probe = boundProbe(
      operation,
      plate,
      context.tools,
      method,
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
    // The entry the operation's binding maps its probe number to, which holds the probe.
    const table =
      operation.tools.find((item) => item.local === source.probe)?.plate ?? null
    const refused = method.refuses?.(probe.value.tool, table)
    if (refused)
      return fail(
        error("probing-probe", `${operation.name}: ${refused}`, {
          subject,
          fix: { kind: "assign-tool", toolNumber: table },
        })
      )
    const generated = generateProbing(method, source, {
      plate,
      probe: probe.value,
      machine,
      machining: plateMachining(plate, kit),
    })
    if (!generated?.ok)
      return fail(
        error(
          "probing-invalid",
          `${operation.name}: ${generated?.issues.at(0)?.message ?? INVALID[source.task]}`,
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
}

export const OPERATION_KINDS: {
  readonly [TKind in SourceKind]: OperationKind<TKind>
} = {
  facing: facingKind,
  file: fileKind,
  pcb: pcbKind,
  unsupported: unsupportedKind,
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
