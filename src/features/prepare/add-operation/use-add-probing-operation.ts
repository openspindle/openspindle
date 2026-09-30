import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import { DEFAULT_KIT, kitForPlate } from "@/domain/fixtures/catalog"
import { probingOf } from "@/domain/operations/kinds"
import type { ProbingSourceKind } from "@/domain/operations/kinds"
import { createOperation } from "@/domain/operations/operation"
import { libraryPreferences } from "@/domain/tools/tool-table"
import { useAddOperation } from "./use-add-operation"

/**
 * The probes of the machine an operation would be added to: the selected plate's, or the default
 * kit's before any plate is selected, since a new plate starts from it too.
 */
export function useProbesForAdding() {
  return useWorkspace((state) => {
    const plate = selectedPlate(state)
    return (plate ? kitForPlate(plate) : DEFAULT_KIT).probes
  })
}

/**
 * Adds a built-in probing operation (auto-level, auto Z-height, auto-scan or 3D probing) with the
 * registry's defaults (`probingOf`), fitted to the plate it is added to and probing or tracing
 * with the library's probes; false when none of the machine's probes offers this kind.
 */
export function useAddProbingOperation(kind: ProbingSourceKind) {
  const library = useWorkspace((state) => state.tools)
  const probes = useProbesForAdding()
  const add = useAddOperation({ stock: false })
  const probing = probingOf(kind)
  return () => {
    const make = probing.offer(probes)
    if (!make) return false
    return add((plate) => ({
      operation: createOperation(probing.label, make(plate)),
      preferredTools: libraryPreferences(
        probes.map((probe) => probe.slot),
        library
      ),
    }))
  }
}
