import { useId, useState } from "react"
import { LocateFixed } from "lucide-react"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { Hint } from "@/components/workspace/hint"
import { centerAutoZHeight, workAreaMiddle } from "@/domain/auto-z-height/fit"
import {
  AUTO_Z_HEIGHT_FIELDS,
  autoZHeightParamsSchema,
} from "@/domain/auto-z-height/params"
import type {
  AutoZHeightParameters,
  AutoZHeightParams,
} from "@/domain/auto-z-height/params"
import {
  NumericFields,
  PlacementFields,
  WorkAreaField,
  probingField,
} from "@/features/probing/probing-fields"
import {
  fromWorkOrigin,
  useProbingDraft,
  useProbingForm,
} from "@/features/probing/probing-form"
import type {
  ProbingAnchorOption,
  WorkAreaFit,
} from "@/features/probing/probing-form"
import type { AnchorPlacement } from "@/domain/probing/placement"

export type AutoZHeightSettingsProps = {
  value: AutoZHeightParams
  /** The touch-off's parameters on the machine's probe: defaults, ranges and descriptions. */
  parameters: AutoZHeightParameters
  /** Stored anchors of the plate's device that the touch point can be relative to. */
  anchors: readonly ProbingAnchorOption[]
  /** Where the plate cuts, or its stock without machining: Center touches its middle. */
  workArea: WorkAreaFit
  /** Receives complete, valid parameters as soon as an edit makes them valid. */
  onChange: (value: AutoZHeightParams) => void
  disabled?: boolean
}

/** Where Center touches, or why there is nothing to center on. */
function centerDescription({ result, origin, anchors }: WorkAreaFit) {
  if (!result.ok) return result.reason
  const [x, y] = fromWorkOrigin(workAreaMiddle(result.area), origin)
  const middle =
    result.covers === "cuts"
      ? `The middle of the cuts is X ${x} Y ${y} from the work origin.`
      : `The plate has no machining operations; the middle of its stock is X ${x} Y ${y} from the work origin.`
  if (anchors.length)
    return `${middle} Center touches there, relative to a stored anchor.`
  return `${middle} Without stored anchors, position the probe there before Run.`
}

/** Why Center is unavailable; null when it can place the touch point. */
function centerReason({ result, anchors }: WorkAreaFit) {
  if (!result.ok) return result.reason
  if (!anchors.length)
    return "Centering needs the stored anchors of the plate's device."
  return null
}

/**
 * Parameters of a built-in auto Z-height operation. Edits apply as soon as the parameters are
 * valid; invalid input stays in the form with its errors and is never passed on.
 */
export function AutoZHeightSettings({
  value,
  parameters,
  anchors,
  workArea,
  onChange,
  disabled = false,
}: AutoZHeightSettingsProps) {
  const draft = useProbingDraft(value, onChange)
  return (
    <AutoZHeightForm
      key={draft.key}
      value={value}
      parameters={parameters}
      anchors={anchors}
      workArea={workArea}
      disabled={disabled}
      onChange={draft.onChange}
    />
  )
}

function AutoZHeightForm({
  value,
  parameters,
  anchors,
  workArea,
  onChange,
  disabled,
}: Required<AutoZHeightSettingsProps>) {
  const id = useId()
  const schema = autoZHeightParamsSchema(parameters)
  // Switching back from the probe position restores the anchor settings.
  const [lastAnchor, setLastAnchor] = useState<AnchorPlacement | null>(null)
  const form = useProbingForm(value, schema, onChange)

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>
          <Hint text="The probed surface becomes work Z0, and the plate's work origin stays on the stock top.">
            Touch-off
          </Hint>
        </FieldLegend>
        <FieldGroup className="gap-3">
          <NumericFields
            id={id}
            disabled={disabled}
            fields={AUTO_Z_HEIGHT_FIELDS.map((name) => ({
              name,
              parameter: parameters[name],
              field: probingField(form, name),
            }))}
          />
        </FieldGroup>
      </FieldSet>
      <PlacementFields
        placement={probingField(form, "placement")}
        anchors={anchors}
        lastAnchor={lastAnchor}
        setLastAnchor={setLastAnchor}
        disabled={disabled}
        action={(placement, setPlacement) => (
          <WorkAreaField
            description={centerDescription(workArea)}
            action="Center"
            icon={<LocateFixed data-icon="inline-start" />}
            reason={centerReason(workArea)}
            disabled={disabled}
            onApply={() => {
              if (!workArea.result.ok) return
              const next = centerAutoZHeight(
                workArea.result.area,
                workArea.anchors,
                placement,
                lastAnchor
              )
              if (next) setPlacement(next)
            }}
          />
        )}
      />
    </FieldGroup>
  )
}
