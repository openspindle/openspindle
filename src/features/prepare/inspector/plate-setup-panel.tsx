import { useRef } from "react"
import { toast } from "sonner"
import { FieldGroup } from "@/components/ui/field"
import {
  usePlateIndex,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import type { AnchorXY } from "@/domain/anchors/stored-anchors"
import { numberedPlate } from "@/domain/plate/plate"
import type { Plate, PlateSetup } from "@/domain/plate/plate"
import {
  touchesOffWorkZ,
  workOriginFromMachine,
} from "@/domain/plate/work-origin"
import type { MachineAction } from "@/features/job/job-hooks"
import { NameField } from "@/components/name-field"
import { useFreshTelemetry } from "@/platform/machine"
import { useReadAnchorsFix } from "../quick-fix"
import {
  AssistFields,
  StockPlacementFields,
  WorkOriginFields,
} from "./setup-fields"
import { StockFields } from "./stock-fields"

/**
 * Read device for a plate's work origin: reads the connected device's anchors, as Read anchors
 * does, then puts the work origin's X and Y where the device kept its work zero when asked.
 */
function useReadDeviceOrigin(
  plateId: string,
  onChange: (patch: Partial<PlateSetup>) => void
): MachineAction {
  const origin = useFreshTelemetry()?.workOrigin ?? null
  const asked = useRef<AnchorXY | null>(null)
  const readAnchors = useReadAnchorsFix(plateId, (plate) => {
    const workOrigin =
      asked.current && workOriginFromMachine(plate.setup, asked.current)
    if (!workOrigin) {
      toast.error(
        "The plate's anchors are not the connected device's, so its work origin was not changed."
      )
      return
    }
    onChange({ workOrigin })
    toast.success("Origin read from the device.")
  })
  return {
    reason:
      readAnchors.reason ??
      (origin ? null : "The device has not reported its work zero."),
    pending: readAnchors.pending,
    run: () => {
      asked.current = origin && [origin.x, origin.y]
      readAnchors.run()
    },
  }
}

/** Changes a plate's setup, saying why where the workspace refuses. */
function useSetupChange(plateId: string) {
  const workspace = useWorkspaceStore()
  return (patch: Partial<PlateSetup>) => {
    const result = workspace.dispatch({ type: "plate.setup", plateId, patch })
    if (!result.ok) toast.error(result.error)
  }
}

/** The plate's stock and where it sits on the bed. */
export function PlateStockPanel({ plate }: { plate: Plate }) {
  const onChange = useSetupChange(plate.id)
  const props = { setup: plate.setup, onChange }
  return (
    <FieldGroup className="p-4" aria-label="Stock">
      <StockFields plateId={plate.id} {...props} />
      <StockPlacementFields {...props} />
    </FieldGroup>
  )
}

/** The plate's own settings: its name, origin and assists; its stock has a panel of its own. */
export function PlateSetupPanel({ plate }: { plate: Plate }) {
  const workspace = useWorkspaceStore()
  const index = usePlateIndex(plate.id)
  const onChange = useSetupChange(plate.id)
  const readDevice = useReadDeviceOrigin(plate.id, onChange)
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
      <WorkOriginFields {...props} zLock={zLock} readDevice={readDevice} />
      <AssistFields {...props} />
    </FieldGroup>
  )
}
