import { useMemo } from "react"
import { useDiagnosticsOf } from "@/app/workspace/use-plate-diagnostics"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { problemMarkerId } from "@/components/workspace/bed-viewer-layout"
import type { ViewerProblem } from "@/components/workspace/bed-viewer"
import { keyDiagnostics } from "@/domain/diagnostics"
import type { Diagnostic, Place } from "@/domain/diagnostics"

const placed = (
  places: readonly Place[] | undefined
): places is readonly [Place, ...Place[]] => !!places?.length

/** A diagnostic as the 3D view marks it; null for one without a place on the bed. */
export function viewerProblem(
  plateId: string,
  key: string,
  { severity, message, places }: Diagnostic
): ViewerProblem | null {
  return placed(places) ? { plateId, key, severity, message, places } : null
}

/**
 * Every workspace plate's problems with a place on its bed, as the 3D view marks them, and the
 * diagnostic each marker stands for (by `problemMarkerId`).
 */
export function useWorkspaceProblems() {
  const plates = useWorkspace((state) => state.plates)
  const diagnosticsOf = useDiagnosticsOf()
  return useMemo(() => {
    const problems: ViewerProblem[] = []
    const diagnostics = new Map<string, Diagnostic>()
    for (const plate of plates)
      for (const { key, diagnostic } of keyDiagnostics(diagnosticsOf(plate))) {
        const problem = viewerProblem(plate.id, key, diagnostic)
        if (!problem) continue
        problems.push(problem)
        diagnostics.set(problemMarkerId(problem), diagnostic)
      }
    return { problems, diagnostics }
  }, [plates, diagnosticsOf])
}
