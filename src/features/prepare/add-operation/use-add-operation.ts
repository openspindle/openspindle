import { toast } from "sonner"
import { targetPlate } from "@/app/workspace/defaults"
import type { TransferableOperation } from "@/app/workspace/import-files"
import {
  selectedPlate,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import type { Plate } from "@/domain/plate/plate"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import { useImportContext } from "@/features/shell/use-import"
import { usePrepareSelection } from "../plate-tree/use-prepare-selection"

/** An operation to add, with the library tools meant for its own tool numbers. */
export type AddedOperation = TransferableOperation & {
  /**
   * Library tools put on its own tool numbers once it is added, replacing what the plate's table
   * holds there: binding keeps a held entry's tool (`bindTools`), which `preferredTools` cannot.
   */
  readonly assignedTools?: ReadonlyMap<number | null, string>
}

/**
 * Adds a generated operation: to the selected plate, or to a new plate when there is none
 * (or only the empty plate, set up as that was). An operation fitted to its plate is made
 * for the plate it goes to. The operation is selected so its settings show. One that machines
 * nothing, such as probing, needs no `stock`, and brings none.
 */
export function useAddOperation({ stock = true }: { stock?: boolean } = {}) {
  const workspace = useWorkspaceStore()
  const context = useImportContext()
  const selection = usePrepareSelection()
  return (
    adding: AddedOperation | ((plate: Plate) => AddedOperation)
  ): boolean => {
    const selected = selectedPlate(workspace.state)
    const plate = targetPlate(selected, context(), stock)
    const added = typeof adding === "function" ? adding(plate) : adding
    const add: WorkspaceCommand = {
      type: "operation.add",
      plateId: plate.id,
      operation: added.operation,
      preferredTools: added.preferredTools,
    }
    const commands: WorkspaceCommand[] = [
      ...(plate === selected
        ? []
        : [{ type: "plates.add" as const, plates: [plate], select: true }]),
      add,
      ...(added.assignedTools
        ? [
            {
              type: "operation.tools" as const,
              plateId: plate.id,
              operationId: added.operation.id,
              tools: added.assignedTools,
            },
          ]
        : []),
    ]
    const result = workspace.dispatch(
      commands.length === 1 ? add : { type: "batch", commands }
    )
    if (!result.ok) {
      toast.error(result.error)
      return false
    }
    selection.selectOperation(plate.id, added.operation.id)
    return true
  }
}
