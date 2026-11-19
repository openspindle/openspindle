import { toast } from "sonner"
import {
  useSelectedPlate,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { PatternEditor } from "./pattern-editor"
import type { PatternSpec } from "@/domain/operations/pattern"
import type { PatternOutput } from "./pattern-core"
import { PrepareViewer } from "@/features/prepare/prepare-viewer"

/** The operation editor shares OpenSpindle's actual 3D bed viewer after committing a toolpath. */
export function PatternPage({ operationId }: { operationId: string | null }) {
  const plate = useSelectedPlate()
  const operation = plate?.operations.find((item) => item.id === operationId)
  const pattern = operation?.source.kind === "pattern" ? operation : null
  const definition =
    operation?.source.kind === "pattern"
      ? operation.source.definition
      : undefined
  const workspace = useWorkspaceStore()
  const apply = (nextDefinition: PatternSpec, output: PatternOutput) => {
    if (!plate || !pattern) return
    const result = workspace.dispatch({
      type: "operation.source",
      plateId: plate.id,
      operationId: pattern.id,
      expectedRevision: pattern.revision,
      source: {
        kind: "pattern",
        tool: nextDefinition.tool,
        definition: nextDefinition,
        nc: output.generated.gcode,
      },
    })
    if (result.ok) toast.success("Toolpath added to the selected operation.")
    else toast.error(result.error)
  }
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <PatternEditor
          key={pattern?.id ?? "independent"}
          initial={definition}
          onApply={pattern ? apply : undefined}
        />
      </div>
      {pattern && (
        <details className="shrink-0 border-t">
          <summary className="cursor-pointer px-4 py-2 text-xs font-medium">
            OpenSpindle 3D machine and stock viewer (saved operation)
          </summary>
          <div className="h-[320px] border-t">
            <PrepareViewer />
          </div>
        </details>
      )}
    </main>
  )
}
