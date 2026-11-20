import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { selectedPlate, useWorkspace } from "@/app/workspace/workspace-context"
import { PrepareViewer } from "@/features/prepare/prepare-viewer"
import { FacingEditor } from "@/features/workshop/facing-dialog"

const id = z.string().min(1).max(200).optional().catch(undefined)

export const Route = createFileRoute("/_workspace/facing")({
  validateSearch: z.object({ plate: id, operation: id }),
  component: FacingRoute,
})

function FacingRoute() {
  const { plate: plateId, operation: operationId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const plate = useWorkspace((state) =>
    plateId
      ? state.plates.find((item) => item.id === plateId)
      : selectedPlate(state)
  )
  const operation = plate?.operations.find(
    (item) => item.id === operationId && item.source.kind === "facing"
  )
  return (
    <main className="flex min-h-0 min-w-0 flex-1">
      <section className="flex min-h-0 w-[min(28rem,55%)] min-w-0 flex-col border-r">
        <h1 className="shrink-0 border-b px-4 py-3 font-medium">
          {operation ? operation.name : "Facing"}
        </h1>
        <FacingEditor
          key={JSON.stringify([plate?.id, operationId])}
          plateId={plateId ?? plate?.id}
          operationId={operationId}
          onSaved={(savedPlate, savedOperation) =>
            void navigate({
              search: { plate: savedPlate, operation: savedOperation },
              replace: true,
            })
          }
        />
      </section>
      <section
        className="relative flex min-w-0 flex-1"
        aria-label="Saved toolpath preview"
      >
        <PrepareViewer />
      </section>
    </main>
  )
}
