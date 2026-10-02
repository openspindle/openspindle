import { useEffect } from "react"
import { useWorkspace } from "@/app/workspace/workspace-context"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import { closeDialog, useOpenDialog } from "./dialogs"
import type { WorkspaceDialog } from "./dialogs"

const hasPlate = (state: WorkspaceState, plateId: string) =>
  state.plates.some((plate) => plate.id === plateId)

/** Whether the plate or operation a dialog is about still exists. */
function subjectExists(dialog: WorkspaceDialog, state: WorkspaceState) {
  switch (dialog.kind) {
    case "stock":
    case "add-fixture":
      return hasPlate(state, dialog.plateId)
    case "tools":
      return !dialog.assign || hasPlate(state, dialog.assign.plateId)
    case "source": {
      const plate = state.plates.find((item) => item.id === dialog.plateId)
      if (!plate) return false
      return (
        dialog.operationId === null ||
        plate.operations.some(
          (operation) => operation.id === dialog.operationId
        )
      )
    }
    default:
      return true
  }
}

/**
 * Closes a dialog whose plate or operation is gone (removed, or replaced by an opened
 * project); it would otherwise stay open invisibly and keep window-wide drops disabled.
 */
export function useCloseOrphanedDialog() {
  const dialog = useOpenDialog()
  const orphaned = useWorkspace(
    (state) => dialog !== null && !subjectExists(dialog, state)
  )
  useEffect(() => {
    if (orphaned) closeDialog()
  }, [orphaned])
}
