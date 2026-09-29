import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  describeProblems,
  readOperations,
  readPlates,
} from "@/app/workspace/import-files"
import {
  selectedPlate,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { plural } from "@/domain/primitives"
import { readEnvelope } from "@/formats/plate-envelope"
import { useHost } from "@/platform/host-context"
import {
  addOperations,
  useImportContext,
  WORKSPACE_MUTATION,
  workspaceScope,
} from "./use-import"

/**
 * Imports a native file choice into the selected plate, or starts a new plate. OpenSpindle
 * exports always start a plate so their embedded setup and editable operations stay together.
 */
export function useNativeImport() {
  const host = useHost()
  const workspace = useWorkspaceStore()
  const context = useImportContext()
  return useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "native-import"],
    scope: workspaceScope,
    mutationFn: async () => {
      const opened = await host.files.open("program")
      if (opened.status === "canceled") return null
      const files = [new File([opened.contents], opened.fileName)]
      const target = selectedPlate(workspace.state)
      const exported = readEnvelope(opened.contents).version !== null
      if (target && !target.example && !exported) {
        const { operations, problems } = await readOperations(files, context())
        if (problems.length) throw new Error(describeProblems(problems))
        const refused = addOperations(workspace.dispatch, target.id, operations)
        if (refused) throw new Error(refused)
        return operations.length
          ? `Added ${plural(operations.length, "operation")}.`
          : null
      }
      const { plates, problems } = await readPlates(files, context())
      if (problems.length) throw new Error(describeProblems(problems))
      if (!plates.length) return null
      const added = workspace.dispatch({
        type: "plates.add",
        plates,
        select: true,
      })
      if (!added.ok) throw new Error(added.error)
      return `Imported ${plural(plates.length, "program")}.`
    },
    onSuccess: (message) => {
      if (message) toast.success(message)
    },
    onError: (error) => toast.error(error.message),
  })
}
