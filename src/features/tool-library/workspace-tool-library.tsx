import { toast } from "sonner"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { isProbeSlot } from "@/domain/tools/tool-table"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import type { Tool } from "@/domain/tools/tool"
import { ToolLibraryDialog } from "./tool-library-dialog"

export type ToolAssignment = {
  readonly plateId: string
  readonly number: number | null
}

/**
 * A probe slot (T0, the 3D probe's) opens on probes; another tool is allowed, and the plate
 * reports it until fixed.
 */
const PROBE_KINDS = ["probe"]

/**
 * The workspace's tool library for ToolLibraryDialog: its tools, and library edits. Dispatching
 * `library.tools` keeps the default tool when it survives the edit, or picks the first tool.
 */
export function useWorkspaceLibrary() {
  const workspace = useWorkspaceStore()
  const tools = useWorkspace((state) => state.tools)
  const defaultToolId = useWorkspace((state) => state.defaultToolId)
  return {
    tools,
    defaultToolId,
    onChange: (next: Tool[]) => {
      workspace.dispatch({ type: "library.tools", tools: next })
    },
  }
}

/**
 * The tool library bound to the workspace: edits change the library, and choosing a tool
 * assigns it to a plate's tool table entry when one is being assigned.
 */
export function WorkspaceToolLibrary({
  assign,
  onClose,
}: {
  assign?: ToolAssignment
  onClose: () => void
}) {
  const workspace = useWorkspaceStore()
  const library = useWorkspaceLibrary()
  const assignedId = useWorkspace((state) => {
    if (!assign) return undefined
    return state.plates
      .find((plate) => plate.id === assign.plateId)
      ?.tools.find((entry) => entry.number === assign.number)?.toolId
  })
  const probeSlot = assign !== undefined && isProbeSlot(assign.number)
  return (
    <ToolLibraryDialog
      tools={library.tools}
      selectedId={assignedId ?? library.defaultToolId ?? ""}
      // Deleting the assigned tool must not assign another: the plate keeps the dangling entry.
      selectionOnly={assign !== undefined}
      recommendedKinds={probeSlot ? PROBE_KINDS : undefined}
      onChange={library.onChange}
      onSelect={(toolId) => {
        // One change: setting the default and assigning it to the plate must not happen apart.
        const setDefault: WorkspaceCommand = {
          type: "library.tools",
          tools: workspace.state.tools,
          defaultToolId: toolId,
        }
        const result = workspace.dispatch(
          assign
            ? {
                type: "batch",
                commands: [
                  setDefault,
                  {
                    type: "tool.assign",
                    plateId: assign.plateId,
                    number: assign.number,
                    toolId,
                  },
                ],
              }
            : setDefault
        )
        if (!result.ok) toast.error(result.error)
      }}
      onClose={onClose}
    />
  )
}
