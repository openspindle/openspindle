import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  findFusionProgram,
  planFusionUpdate,
} from "@/app/workspace/import-fusion-program"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import {
  WORKSPACE_MUTATION,
  useImportContext,
  useImportPlanned,
  workspaceScope,
} from "@/features/shell/use-import"
import { useHost } from "@/platform/host-context"

/**
 * Updates an operation imported from Fusion 360 from its NC program as it is now: finds the
 * program again among the open documents, posts it, and checks it as importing did. What was
 * resolved then is resolved alike, and the import questionnaire asks about anything new.
 */
export function useFusionUpdate() {
  const fusion = useHost().fusion
  const workspace = useWorkspaceStore()
  const context = useImportContext()
  const importPlanned = useImportPlanned()
  return useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "fusion360-update"],
    scope: workspaceScope,
    mutationFn: async ({
      plateId,
      operationId,
    }: {
      plateId: string
      operationId: string
    }) => {
      const plate = workspace.state.plates.find((item) => item.id === plateId)
      const operation = plate?.operations.find(
        (item) => item.id === operationId
      )
      const origin =
        operation?.source.kind === "file" ? operation.source.origin : undefined
      if (!plate || !operation || !origin)
        throw new Error("This operation did not come from Fusion 360.")
      if (!(await fusion.snapshot()).connected)
        throw new Error(
          "Connect Fusion 360 first: in Fusion, click OpenSpindle › Connect to OpenSpindle."
        )
      const found = findFusionProgram(await fusion.list(), origin)
      if (!found.ok) throw new Error(found.error)
      const program = await fusion.read(found.value.id)
      return planFusionUpdate(
        program,
        plate,
        operation,
        origin,
        context(),
        workspace.state.designRules
      )
    },
    onSuccess: (plan) => {
      importPlanned(plan)
    },
    onError: (error) => toast.error(error.message),
  })
}
