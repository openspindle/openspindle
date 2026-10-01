import { compilePlate } from "@/domain/compile/compile"
import { operationSubject, toolSubject } from "@/domain/diagnostics"
import type { Diagnostic } from "@/domain/diagnostics"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { Plate } from "@/domain/plate/plate"
import { failureDiagnostic } from "@/domain/rules/diagnostics"
import { rulesOf } from "@/domain/rules/rules"
import type { OperationRuleSubject } from "@/domain/rules/stages"
import { toolRuleSubjects } from "@/domain/tools/tool-table"
import type { Tool } from "@/domain/tools/tool"
import { runRules } from "@/machine/contract"

export type DiagnosticContext = {
  readonly tools: readonly Tool[]
}

/** Each plate's latest diagnostics, with the context they were gathered in. */
const gathered = new WeakMap<
  Plate,
  DiagnosticContext & { readonly diagnostics: readonly Diagnostic[] }
>()

/**
 * Everything that blocks or qualifies Run and export for a plate, in one list: what compiling
 * reports, then the operations' advice and the tool table's failures. A plate without
 * operations is not a problem to report: Run and export refuse it on their own. Kept per plate
 * object while the tools stay the same, so unchanged plates gather nothing again.
 */
export function plateDiagnostics(
  plate: Plate,
  context: DiagnosticContext
): readonly Diagnostic[] {
  const saved = gathered.get(plate)
  if (saved?.tools === context.tools) return saved.diagnostics
  const compiled = compilePlate(plate)
  const kit = kitForPlate(plate)
  const operations = plate.operations.map(
    (operation): OperationRuleSubject => ({ operation, plate, kit, compiled })
  )
  const run = { machine: kit.id }
  const diagnostics = [
    ...compiled.diagnostics,
    ...runRules(rulesOf("operation"), operations, run).map((failure) =>
      failureDiagnostic(failure, operationSubject(failure.first.operation.id))
    ),
    ...runRules(
      rulesOf("tool"),
      toolRuleSubjects(plate, context.tools),
      run
    ).map((failure) =>
      failureDiagnostic(failure, toolSubject(failure.first.entry.number))
    ),
  ]
  gathered.set(plate, {
    tools: context.tools,
    diagnostics,
  })
  return diagnostics
}
