import { diagnosticOperation } from "@/domain/diagnostics"
import type { Diagnostic } from "@/domain/diagnostics"
import { focusProblem } from "@/features/viewer/problem-focus"
import type { ProblemFocus } from "@/features/viewer/problem-focus"
import { usePrepareSelection } from "./plate-tree/use-prepare-selection"
import { clearSectionSelection } from "./selection"

/**
 * Shows a problem in the 3D view with what it is about selected: its operation, else its plate.
 * Selected program sections would be highlighted instead of its lines, so none stay selected.
 */
export function useShowProblem() {
  const selection = usePrepareSelection()
  return ({ plateId, key }: ProblemFocus, diagnostic: Diagnostic | null) => {
    const operationId = diagnostic && diagnosticOperation(diagnostic)
    if (operationId) selection.selectOperation(plateId, operationId)
    else selection.selectPlate(plateId)
    clearSectionSelection()
    focusProblem({ plateId, key })
  }
}
