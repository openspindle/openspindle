import { Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldLegend, FieldSet } from "@/components/ui/field"
import { INSPECTION_RECIPES } from "@/domain/probing/inspection-recipes"
import { openDialog } from "@/features/shell/dialogs"
import { ControlCard } from "./device-control-card"
import { openZProbe } from "./z-probe-dialog"

/** Shortcuts open the existing docked guides; they never send machine commands. */
export function DeviceUsefulTools({
  calibrationName,
  probing,
}: {
  calibrationName: string | null
  probing: boolean
}) {
  if (!probing && !calibrationName) return null
  return (
    <ControlCard title="Useful tools" icon={<Wrench size={16} />}>
      <div className="grid grid-cols-2 gap-2">
        {calibrationName && (
          <Button
            variant="outline"
            onClick={() => openDialog({ kind: "anchor-calibration" })}
          >
            {calibrationName} probe
          </Button>
        )}
        {probing && (
          <>
            <Button
              variant="outline"
              onClick={() => openDialog({ kind: "probing" })}
            >
              3D probe routines
            </Button>
            <Button variant="outline" onClick={() => openZProbe()}>
              Z probe routines
            </Button>
            <Button
              variant="outline"
              onClick={() => openDialog({ kind: "probe-diameter-calibration" })}
            >
              Probe diameter
            </Button>
          </>
        )}
      </div>
      {probing && (
        <FieldSet>
          <FieldLegend>Inspection</FieldLegend>
          <div className="grid grid-cols-2 gap-2">
            {INSPECTION_RECIPES.map((recipe) => (
              <Button
                key={recipe.id}
                variant="outline"
                onClick={() =>
                  openDialog({ kind: "inspection", recipe: recipe.id })
                }
              >
                {recipe.label}
              </Button>
            ))}
          </div>
        </FieldSet>
      )}
    </ControlCard>
  )
}
