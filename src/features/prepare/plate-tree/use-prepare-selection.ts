import { useMatch, useNavigate } from "@tanstack/react-router"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import type { PrepareSearch } from "@/routes/_workspace/prepare"
import { selectSetupItem } from "../arrange/arrange-state"
import { clearSectionSelection } from "../selection"

const NO_SELECTION: PrepareSearch = {}

/**
 * The Prepare selection: the plate lives in the workspace, the operation in the URL.
 * Usable from any workspace route (a menu command can open a Prepare dialog from Job
 * before the Prepare match exists): the selection is empty there, and selecting shows
 * Prepare.
 */
export function usePrepareSelection() {
  const search = useMatch({
    from: "/_workspace/prepare",
    shouldThrow: false,
    select: (match) => match.search,
  })
  const current = search ?? NO_SELECTION
  const navigate = useNavigate()
  const workspace = useWorkspaceStore()
  const show = (next: PrepareSearch) =>
    void navigate({ to: "/prepare", search: next, replace: true })
  return {
    operationId: current.operation ?? null,
    panel: current.panel,
    selectPlate: (plateId: string) => {
      workspace.dispatch({ type: "plate.select", plateId })
      clearSectionSelection()
      show({ panel: current.operation ? undefined : current.panel })
    },
    selectOperation: (plateId: string, operationId: string) => {
      workspace.dispatch({ type: "plate.select", plateId })
      // One thing is selected at a time: the operation, not a setup item too.
      selectSetupItem(null)
      if (current.operation !== operationId) clearSectionSelection()
      show({ operation: operationId })
    },
    showPanel: (panel: PrepareSearch["panel"]) =>
      show({ operation: current.operation, panel }),
    /**
     * Shows a plate's settings for something of its setup selected in the viewer, on the
     * given panel or the current one; its sections stay selected while it stays selected.
     */
    showPlateSetup: (plateId: string, panel?: PrepareSearch["panel"]) => {
      if (workspace.state.selectedPlateId !== plateId) {
        workspace.dispatch({ type: "plate.select", plateId })
        clearSectionSelection()
      }
      show({ panel: panel ?? (current.operation ? undefined : current.panel) })
    },
  }
}
