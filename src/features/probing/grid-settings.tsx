import { useEffect, useId, useRef, useState } from "react"
import { Scan } from "lucide-react"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { fitGrid } from "@/domain/probing/tasks/grid/fit"
import { GridParamsSchema } from "@/domain/probing/tasks/grid/params"
import type { GridSpecs, GridParams } from "@/domain/probing/tasks/grid/params"
import { rangedSchema } from "@/domain/probing/parameters"
import {
  ParameterField,
  PlacementFields,
  SwitchField,
  WorkAreaField,
  probingField,
} from "@/features/probing/probing-fields"
import type { ProbingPick } from "@/features/probing/probing-fields"
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

export type GridSettingsProps = {
  value: GridParams
  /** The grid's parameters with its strategy on the plate's machine: defaults, ranges and descriptions. */
  parameters: GridSpecs
  /** Stored anchors of the plate's device that the grid can start from. */
  anchors: readonly ProbingAnchorOption[]
  /** Where the plate cuts, or its stock without machining: what Fit grid covers. */
  workArea: WorkAreaFit
  /** Receives complete, valid parameters as soon as an edit makes them valid. */
  onChange: (value: GridParams) => void
  /** Picking its start in the 3D view; null where it cannot be picked. */
  pick?: ProbingPick | null
  disabled?: boolean
  onValidityChange?: (valid: boolean) => void
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
 * Parameters of a grid probing operation. Edits apply as soon as the parameters are valid;
 * invalid input stays in the form with its errors and is never passed on.
 */
export function GridSettings({
  value,
  parameters,
  anchors,
  workArea,
  onChange,
  pick = null,
  disabled = false,
  onValidityChange,
}: GridSettingsProps) {
  const draft = useProbingDraft(value, onChange)
  return (
    <GridForm
      key={draft.key}
      value={value}
      parameters={parameters}
      anchors={anchors}
      workArea={workArea}
      pick={pick}
      disabled={disabled}
      onChange={draft.onChange}
      onValidityChange={onValidityChange}
    />
  )
}

function GridForm({
  value,
  parameters,
  anchors,
  workArea,
  onChange,
  pick,
  disabled,
  onValidityChange,
}: Required<Omit<GridSettingsProps, "onValidityChange">> &
  Pick<GridSettingsProps, "onValidityChange">) {
  const id = useId()
  const schema = rangedSchema(GridParamsSchema, parameters)
  // Switching back from the probe position restores the anchor settings.
  const [lastAnchor, setLastAnchor] = useState<AnchorPlacement | null>(null)
  const [parametersValid, setParametersValid] = useState(true)
  const [placementReady, setPlacementReady] = useState(true)
  const validityListener = useRef(onValidityChange)
  validityListener.current = onValidityChange
  useEffect(() => {
    validityListener.current?.(parametersValid && placementReady)
  }, [parametersValid, placementReady])
  const form = useProbingForm(value, schema, onChange, (valid) => {
    setParametersValid(valid)
    onValidityChange?.(valid && placementReady)
  })
  const fitToWorkArea = () => {
    if (!workArea.result.ok) return
    const fitted = fitGrid(
      workArea.result.area,
      workArea.anchors,
      form.state.values.placement,
      lastAnchor,
      parameters
    )
    // One change for the three values: only the last one runs the listener.
    form.setFieldValue("size[0]", fitted.size[0], { dontRunListeners: true })
    form.setFieldValue("size[1]", fitted.size[1], { dontRunListeners: true })
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
            onApply={fitToWorkArea}
          />
          <ParameterField
            id={`${id}-width`}
            parameter={parameters.size[0]}
            field={probingField(form, "size[0]")}
            disabled={disabled}
          />
          <ParameterField
            id={`${id}-depth`}
            parameter={parameters.size[1]}
            field={probingField(form, "size[1]")}
            disabled={disabled}
          />
          <ParameterField
            id={`${id}-columns`}
            parameter={parameters.points[0]}
            field={probingField(form, "points[0]")}
            disabled={disabled}
          />
          <ParameterField
            id={`${id}-rows`}
            parameter={parameters.points[1]}
            field={probingField(form, "points[1]")}
            disabled={disabled}
          />
          <ParameterField
            id={`${id}-clearance`}
            parameter={parameters.clearance}
            field={probingField(form, "clearance")}
            disabled={disabled}
          />
        </FieldGroup>
      </FieldSet>
      <PlacementFields
        placement={probingField(form, "placement")}
        anchors={anchors}
        lastAnchor={lastAnchor}
        setLastAnchor={setLastAnchor}
        pick={pick}
        disabled={disabled}
        onDraftValidityChange={
          onValidityChange
            ? (ready) => {
                setPlacementReady(ready)
                onValidityChange(ready && parametersValid)
              }
            : undefined
        }
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
