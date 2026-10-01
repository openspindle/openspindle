import { useCallback, useMemo } from "react"
import { plateDiagnostics } from "@/app/workspace/diagnostics"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { keyDiagnostics } from "@/domain/diagnostics"
import type { Diagnostic, KeyedDiagnostic } from "@/domain/diagnostics"
import type { Plate } from "@/domain/plate/plate"

const NONE: readonly Diagnostic[] = []

/**
 * Gathers any workspace plate's diagnostics (`plateDiagnostics`) with the library's tools;
 * a new function once those change.
 */
export function useDiagnosticsOf(): (plate: Plate) => readonly Diagnostic[] {
  const tools = useWorkspace((state) => state.tools)
  return useCallback(
    (plate: Plate) => plateDiagnostics(plate, { tools }),
    [tools]
  )
}

/** Everything that blocks or qualifies Run for a plate (none without a plate). */
export function usePlateDiagnostics(
  plate: Plate | null
): readonly Diagnostic[] {
  const diagnosticsOf = useDiagnosticsOf()
  return useMemo(
    () => (plate ? diagnosticsOf(plate) : NONE),
    [plate, diagnosticsOf]
  )
}

/** A plate's diagnostics with their keys (`keyDiagnostics`). */
export function useKeyedDiagnostics(
  plate: Plate | null
): readonly KeyedDiagnostic[] {
  const diagnostics = usePlateDiagnostics(plate)
  return useMemo(() => keyDiagnostics(diagnostics), [diagnostics])
}
