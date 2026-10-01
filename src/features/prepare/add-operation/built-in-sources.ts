import type { LucideIcon } from "lucide-react"
import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import { DEFAULT_KIT, kitForPlate } from "@/domain/fixtures/catalog"
import {
  machineStrategies,
  newProbingOperation,
  preferredProbe,
} from "@/domain/probing/strategies"
import { PROBING_ICONS } from "@/features/plugins/operation-icon"
import { useAddOperation } from "./use-add-operation"

/** An operation OpenSpindle generates itself, as Add operation and the Prepare toolbar offer it. */
export type BuiltInSource = {
  readonly id: string
  readonly icon: LucideIcon
  readonly title: string
  readonly description: string
  /** Adds the operation and selects it; false when it was not added. */
  readonly add: () => boolean
}

/**
 * The probing strategies of the machine an operation would be added to (the selected plate's,
 * or the default kit's before any plate is selected, since a new plate starts from it too) that
 * a probe of the tool library runs: each adds its operation with that probe, preferring the probe
 * the plate's table already holds.
 */
export function useBuiltInSources(): BuiltInSource[] {
  const library = useWorkspace((state) => state.tools)
  const plate = useWorkspace(selectedPlate)
  const add = useAddOperation({ stock: false })
  const machine = (plate ? kitForPlate(plate) : DEFAULT_KIT).probing
  if (!machine) return []
  return machineStrategies(machine).flatMap((strategy) => {
    const probe = preferredProbe(strategy, machine, library, plate)
    if (!probe) return []
    return [
      {
        id: strategy.id,
        icon: PROBING_ICONS[strategy.task],
        title: strategy.label,
        description: strategy.description,
        add: () =>
          add((target) =>
            newProbingOperation(target, probe, strategy, machine)
          ),
      },
    ]
  })
}
