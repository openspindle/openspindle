import { useId } from "react"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { Plate } from "@/domain/plate/plate"

export function JobZProbeOption({ plate }: { plate: Plate }) {
  const id = useId()
  const workspace = useWorkspaceStore()
  if (!kitForPlate(plate).zProbing) return null
  return (
    <Field orientation="horizontal">
      <Checkbox
        id={id}
        checked={!!plate.setup.probeBeforeRun}
        onCheckedChange={(checked) =>
          workspace.dispatch({
            type: "plate.setup",
            plateId: plate.id,
            patch: { probeBeforeRun: checked === true },
          })
        }
      />
      <FieldContent>
        <FieldLabel htmlFor={id}>Probe part Z before cutting</FieldLabel>
        <FieldDescription>
          Run guides you through measuring the top as Z0, then fitting and
          measuring the cutter.
        </FieldDescription>
      </FieldContent>
    </Field>
  )
}
