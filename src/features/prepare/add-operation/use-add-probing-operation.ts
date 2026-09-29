import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import { DEFAULT_KIT, kitForPlate } from "@/domain/fixtures/catalog"
import { OPERATION_KINDS, probingOf } from "@/domain/operations/kinds"
import type { ProbingSourceKind } from "@/domain/operations/kinds"
import { createOperation } from "@/domain/operations/operation"
import type { OperationSource } from "@/domain/operations/operation"
import {
  PROBE_3D_TOOL,
  PROBE_TOOL,
  libraryPreferences,
} from "@/domain/tools/tool-table"
import { useAddOperation } from "./use-add-operation"

/**
 * The probe of the machine an operation would be added to: the selected plate's, or the default
 * kit's before any plate is selected, since a new plate starts from it too.
 */
export function useProbeForAdding() {
  return useWorkspace((state) => {
    const plate = selectedPlate(state)
    return (plate ? kitForPlate(plate) : DEFAULT_KIT).probe
  })
}

/**
 * Adds a built-in probing operation (auto-level, auto Z-height, auto-scan or 3D probing) with the
 * registry's defaults (`probingOf`, `OPERATION_KINDS`), fitted to the plate it is added to and
 * probing or tracing with the library's probes; false when the machine's probe does not offer
 * this kind.
 */
export function useAddProbingOperation(kind: ProbingSourceKind) {
  const library = useWorkspace((state) => state.tools)
  const probe = useProbeForAdding()
  const add = useAddOperation({ stock: false })
  const registration = probingOf(kind)
  return () => {
    if (!probe || !registration.available(probe)) return false
    return add((plate) => ({
      operation: createOperation(OPERATION_KINDS[kind].label, {
        kind,
        params: registration.defaults(plate, probe),
      } as OperationSource),
      preferredTools: libraryPreferences([PROBE_TOOL, PROBE_3D_TOOL], library),
    }))
  }
}
