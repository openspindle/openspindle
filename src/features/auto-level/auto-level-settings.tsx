import { useId, useState } from "react"
import { Scan } from "lucide-react"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { fitAutoLevelGrid } from "@/domain/auto-level/fit"
import {
  AUTO_LEVEL_GRID_FIELDS,
  autoLevelParamsSchema,
} from "@/domain/auto-level/params"
import type {
  AutoLevelGridParameters,
  AutoLevelParams,
} from "@/domain/auto-level/params"
import {
  NumericFields,
  PlacementFields,
  SwitchField,
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

export type AutoLevelSettingsProps = {
  value: AutoLevelParams
  /** The grid's parameters on the machine's probe: defaults, ranges and descriptions. */
  parameters: AutoLevelGridParameters
  /** Stored anchors of the plate's device that the grid can start from. */
  anchors: readonly ProbingAnchorOption[]
  /** Where the plate cuts, or its stock without machining: what Fit grid covers. */
  workArea: WorkAreaFit
  /** Receives complete, valid parameters as soon as an edit makes them valid. */
  onChange: (value: AutoLevelParams) => void
  disabled?: boolean
}

/** What Fit grid covers, or why there is nothing to fit to. */
function gridFitDescription({ result, origin, anchors }: WorkAreaFit) {
  if (!result.ok) return result.reason
  const [minX, minY] = fromWorkOrigin(result.area.min, origin)
  const [maxX, maxY] = fromWorkOrigin(result.area.max, origin)
  const span = `X ${minX} to ${maxX} and Y ${minY} to ${maxY} mm from the work origin.`
  const extent =
    result.covers === "cuts"
      ? `The cuts cover ${span}`
      : `The plate has no machining operations; its stock covers ${span}`
  if (anchors.length)
    return result.covers === "cuts"
      ? `${extent} Fit grid sizes the grid to them and anchors its start at their lower-left corner.`
      : `${extent} Fit grid sizes the grid to the stock and anchors its start at the stock's lower-left corner.`
  return `${extent} Without stored anchors Fit grid only sizes the grid: position the probe above X ${minX} Y ${minY}.`
}

/**
 * Parameters of a built-in auto-level operation. Edits apply as soon as the parameters are valid;
 * invalid input stays in the form with its errors and is never passed on.
 */
export function AutoLevelSettings({
  value,
  parameters,
  anchors,
  workArea,
  onChange,
  disabled = false,
}: AutoLevelSettingsProps) {
  const draft = useProbingDraft(value, onChange)
  return (
    <AutoLevelForm
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

function AutoLevelForm({
  value,
  parameters,
  anchors,
  workArea,
  onChange,
  disabled,
}: Required<AutoLevelSettingsProps>) {
  const id = useId()
  const schema = autoLevelParamsSchema(parameters)
  // Switching back from the probe position restores the anchor settings.
  const [lastAnchor, setLastAnchor] = useState<AnchorPlacement | null>(null)
  const form = useProbingForm(value, schema, onChange)
  const fitGrid = () => {
    if (!workArea.result.ok) return
    const fitted = fitAutoLevelGrid(
      workArea.result.area,
      workArea.anchors,
      form.state.values.placement,
      lastAnchor,
      parameters
    )
    // One change for the three fields: only the last one runs the listener.
    form.setFieldValue("width", fitted.width, { dontRunListeners: true })
    form.setFieldValue("depth", fitted.depth, { dontRunListeners: true })
    form.setFieldValue("placement", fitted.placement)
  }

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Probe grid</FieldLegend>
        <FieldGroup className="gap-3">
          <WorkAreaField
            description={gridFitDescription(workArea)}
            action="Fit grid"
            icon={<Scan data-icon="inline-start" />}
            reason={workArea.result.ok ? null : workArea.result.reason}
            disabled={disabled}
            onApply={fitGrid}
          />
          <NumericFields
            id={id}
            disabled={disabled}
            fields={AUTO_LEVEL_GRID_FIELDS.map((name) => ({
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
      />
      <form.Field name="reviewAfterProbe">
        {(field) => (
          <SwitchField
            id={`${id}-review`}
            label="Review after probing"
            description="Pause after probing to check the measured height map, then Resume or Stop."
            checked={field.state.value}
            disabled={disabled}
            onCheckedChange={(checked) => field.handleChange(checked)}
          />
        )}
      </form.Field>
    </FieldGroup>
  )
}

// `design-rules-settings.tsx` shares this generic form helper; kept here so it need not move.
export { visibleErrors } from "@/features/probing/probing-form"
