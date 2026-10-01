import { compilePlate } from "@/domain/compile/compile"
import { stockDepthWarnings } from "@/domain/compile/stock-depth"
import type { Diagnostic } from "@/domain/diagnostics"
import { validateOperations } from "@/domain/operations/kinds"
import type { Plate } from "@/domain/plate/plate"
import { toolDiagnostics } from "@/domain/tools/tool-table"
import type { Tool } from "@/domain/tools/tool"

export type DiagnosticContext = {
  readonly tools: readonly Tool[]
}

/** Each plate's latest diagnostics, with the context they were gathered in. */
const gathered = new WeakMap<
  Plate,
  DiagnosticContext & { readonly diagnostics: readonly Diagnostic[] }
>()

/**
 * Everything that blocks or qualifies Run and export for a plate, in one list. A plate without
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
  const diagnostics = [
    ...compiled.diagnostics,
    ...validateOperations(plate),
    ...stockDepthWarnings(plate, compiled),
    ...toolDiagnostics(plate, context.tools),
  ]
  gathered.set(plate, {
    tools: context.tools,
    diagnostics,
  })
  return diagnostics
}
