import { toast } from "sonner"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { projectPlacement } from "@/app/fixtures/plate-profile"
import { newPlate } from "@/app/workspace/import-program"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import { useImportContext } from "@/features/shell/use-import"
import { usePrepareSelection } from "./use-prepare-selection"

/**
 * Adds an empty plate after the others and selects it: the default stock, on the selected
 * fixture profile. The empty plate a new project starts with stays beside it, as a plate of the
 * user's own, rather than being replaced.
 */
export function useAddPlate() {
  const workspace = useWorkspaceStore()
  const fixtures = useFixtureLibraryStore()
  const context = useImportContext()
  const selection = usePrepareSelection()
  return () => {
    const plate = newPlate({
      stock: context().stock,
      placement: projectPlacement(workspace.state, fixtures.state),
    })
    const keep = workspace.state.plates
      .filter((item) => item.example)
      .map((item): WorkspaceCommand => ({
        type: "plate.keep",
        plateId: item.id,
      }))
    const result = workspace.dispatch({
      type: "batch",
      commands: [
        ...keep,
        { type: "plates.add", plates: [plate], select: true },
      ],
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    selection.selectPlate(plate.id)
  }
}
