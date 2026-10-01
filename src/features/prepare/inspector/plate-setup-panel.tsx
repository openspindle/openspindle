import { toast } from "sonner"
import { FieldGroup } from "@/components/ui/field"
import {
  usePlateIndex,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { numberedPlate } from "@/domain/plate/plate"
import type { Plate, PlateSetup } from "@/domain/plate/plate"
import { touchesOffWorkZ } from "@/domain/plate/work-origin"
import { NameField } from "@/components/name-field"
import {
  AssistFields,
  StockPlacementFields,
  WorkOriginFields,
} from "./setup-fields"
import { StockFields } from "./stock-fields"

/** The plate's name, its stock and placement, its work origin and its assists. */
export function PlateSetupPanel({ plate }: { plate: Plate }) {
  const workspace = useWorkspaceStore()
  const index = usePlateIndex(plate.id)
  const onChange = (patch: Partial<PlateSetup>) => {
    const result = workspace.dispatch({
      type: "plate.setup",
      plateId: plate.id,
      patch,
    })
    if (!result.ok) toast.error(result.error)
  }
  const props = { setup: plate.setup, onChange }
  // The touch-off sets work Z0 on the stock top, where the work origin then stays.
  const zLock =
    plate.setup.stock && touchesOffWorkZ(plate)
      ? "Touch-off sets work Z0 on the stock top."
      : undefined
  return (
    <FieldGroup className="p-4" aria-label="Setup">
      <NameField
        key={plate.id}
        name={plate.name}
        placeholder={numberedPlate(index)}
        onRename={(name) =>
          workspace.dispatch({ type: "plate.rename", plateId: plate.id, name })
        }
      />
      <StockFields plateId={plate.id} {...props} />
      <StockPlacementFields {...props} />
      <WorkOriginFields {...props} zLock={zLock} />
      <AssistFields {...props} />
    </FieldGroup>
  )
}
