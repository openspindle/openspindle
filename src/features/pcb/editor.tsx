import { useMutation, useQueryClient } from "@tanstack/react-query"
import { RpcError } from "@openspindle/rpc"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { FieldDescription } from "@/components/ui/field"
import type { SourceOf } from "@/domain/operations/operation"
import type { OperationOf } from "@/domain/operations/kinds"
import { stableJson } from "@/domain/pcb/operation-data"
import { toolAssignments } from "@/domain/pcb/operation-assignments"
import type { PCBOperationData } from "@/domain/pcb/operation-data"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import { pcbSession } from "./session"
import { pcbLocked, usePcbLocked } from "./use-pcb-locked"
import { OperationEditor } from "./operation-editor"

export type PcbSave = {
  session: number
  revision: number
  expectedSource: SourceOf<"pcb">
  assignmentsKey: string
  name?: string
  data: PCBOperationData
  nc: string | null
  toolAssignments: Record<string, string>
}

/** Saves PCB edits as one revision-checked, undoable workspace command batch. */
function usePcbSave(plateId: string, operationId: string) {
  const workspace = useWorkspaceStore()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (next: PcbSave): Promise<OperationOf<"pcb">> => {
      if (next.session !== workspace.session)
        throw new RpcError(
          "CONFLICT",
          "The project changed while this toolpath was being generated."
        )
      if (pcbLocked(queryClient))
        throw new RpcError(
          "UNAVAILABLE",
          "PCB editing is unavailable while importing or running a job."
        )
      const plate = workspace.state.plates.find((item) => item.id === plateId)
      const operation = plate?.operations.find(
        (item) => item.id === operationId
      )
      if (!plate || !operation || operation.source.kind !== "pcb")
        throw new Error("This PCB operation is no longer available.")
      if (
        operation.revision !== next.revision ||
        operation.source !== next.expectedSource ||
        stableJson(toolAssignments(plate, operation as OperationOf<"pcb">)) !==
          next.assignmentsKey
      )
        throw new RpcError(
          "CONFLICT",
          "This operation changed since it was read."
        )
      const target = { plateId, operationId }
      const commands: WorkspaceCommand[] = [
        {
          type: "operation.source",
          ...target,
          expectedRevision: next.revision,
          source: { kind: "pcb", data: next.data, nc: next.nc },
        },
      ]
      if (next.name !== undefined && next.name !== operation.name)
        commands.push({ type: "operation.rename", ...target, name: next.name })
      const tools = new Map<number | null, string>()
      for (const [slot, toolId] of Object.entries(next.toolAssignments)) {
        if (!workspace.state.tools.some((tool) => tool.id === toolId))
          throw new Error(
            "The selected tool is no longer in the library. Choose it again."
          )
        tools.set(slot === "default" ? null : Number(slot), toolId)
      }
      if (tools.size)
        commands.push({ type: "operation.tools", ...target, tools })
      const result = workspace.dispatch({ type: "batch", commands })
      if (!result.ok) throw new Error(result.error)
      const saved = result.value.plates
        .find((item) => item.id === plateId)
        ?.operations.find((item) => item.id === operationId)
      if (!saved || saved.source.kind !== "pcb")
        throw new Error("This PCB operation is no longer available.")
      return saved as OperationOf<"pcb">
    },
  })
}

/** The native side-panel editor of the selected PCB operation. */
export function EditorView({
  plateId,
  operationId,
  disabled = false,
}: {
  plateId: string
  operationId: string
  disabled?: boolean
}) {
  const workspace = useWorkspaceStore()
  const locked = usePcbLocked()
  const session = pcbSession(workspace)
  const plate = useWorkspace((state) =>
    state.plates.find((item) => item.id === plateId)
  )
  const operation = plate?.operations.find((item) => item.id === operationId)
  const save = usePcbSave(plateId, operationId)
  if (!plate || !operation || operation.source.kind !== "pcb")
    return (
      <FieldDescription>
        This PCB operation is no longer available.
      </FieldDescription>
    )
  return (
    <OperationEditor
      key={`${session.id}:${operationId}`}
      session={session}
      plate={plate}
      operation={operation as OperationOf<"pcb">}
      saved={operation.source.data}
      save={save}
      disabled={disabled || locked}
    />
  )
}

export type PcbSaveMutation = ReturnType<typeof usePcbSave>
