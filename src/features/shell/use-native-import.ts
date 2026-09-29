import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { planImport } from "@/app/workspace/import-plan"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { useHost } from "@/platform/host-context"
import {
  WORKSPACE_MUTATION,
  importKit,
  useImportContext,
  useImportPlanned,
  workspaceScope,
} from "./use-import"

/**
 * Imports the NC file chosen in the native file window as a dropped file is: into the selected
 * plate, or a new plate without one, after the import questionnaire asks what it needs to. An
 * OpenSpindle export comes in as a plate of its own, with its setup.
 */
export function useNativeImport() {
  const host = useHost()
  const workspace = useWorkspaceStore()
  const context = useImportContext()
  const importPlanned = useImportPlanned()
  return useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "native-import"],
    scope: workspaceScope,
    mutationFn: async () => {
      const opened = await host.files.open("program")
      if (opened.status === "canceled") return null
      return planImport(
        [new File([opened.contents], opened.fileName)],
        context(),
        importKit(workspace.state),
        workspace.state.designRules
      )
    },
    onSuccess: (plan) => {
      if (plan) importPlanned(plan)
    },
    onError: (error) => toast.error(error.message),
  })
}
