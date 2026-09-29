import { toast } from "sonner"
import { replacementPlate } from "@/app/workspace/defaults"
import type { TransferableOperation } from "@/app/workspace/import-files"
import { newPlate } from "@/app/workspace/import-program"
import type { ImportContext } from "@/app/workspace/import-program"
import {
  selectedPlate,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { createPlate, createPlateSetup } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import { useImportContext } from "@/features/shell/use-import"
import { usePrepareSelection } from "../plate-tree/use-prepare-selection"

/**
 * The plate an operation goes to: the selected plate, else one in place of the empty plate, or a
 * new one. One in place of the empty plate keeps the stock set up there, else starts on the
 * library's default stock, as a new plate does; unless the operation needs no `stock`: then the
 * empty plate's setup stays as it is, and a new plate has none.
 */
function targetPlate(
  selected: Plate | null | undefined,
  context: ImportContext,
  stock: boolean
): Plate {
  if (selected && !selected.example) return selected
  if (stock)
    return selected ? replacementPlate(selected, context) : newPlate(context)
  return createPlate(
    selected
      ? structuredClone(selected.setup)
      : createPlateSetup({
          stock: null,
          stockSource: "unspecified",
          ...context.placement,
        })
  )
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
    adding: TransferableOperation | ((plate: Plate) => TransferableOperation)
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
    const result = workspace.dispatch(
      plate === selected
        ? add
        : {
            type: "batch",
            commands: [
              { type: "plates.add", plates: [plate], select: true },
              add,
            ],
          }
    )
    if (!result.ok) {
      toast.error(result.error)
      return false
    }
    selection.selectOperation(plate.id, added.operation.id)
    return true
  }
}
