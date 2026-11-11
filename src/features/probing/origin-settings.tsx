import { useEffect, useId, useRef, useState } from "react"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import {
  PROBE_3D_AXES,
  PROBE_3D_AXES_LABELS,
  PROBE_3D_CORNERS,
  PROBE_3D_CORNER_LABELS,
  PROBE_3D_ROUTINE_LABELS,
  findsCorner,
  originFields,
  originParamsSchema,
} from "@/domain/probing/tasks/origin/params"
import type {
  Probe3dAxes,
  OriginSpecs,
  OriginParams,
} from "@/domain/probing/tasks/origin/params"
import {
  ParameterField,
  PlacementFields,
  probingField,
} from "@/features/probing/probing-fields"
import type { ProbingPick } from "@/features/probing/probing-fields"
import {
  FIELD_LAYOUT,
  useProbingDraft,
  useProbingForm,
} from "@/features/probing/probing-form"
import type { ProbingAnchorOption } from "@/features/probing/probing-form"
import type { ParameterSpec } from "@/domain/probing/parameters"
import type { AnchorPlacement } from "@/domain/probing/placement"

export type OriginSettingsProps = {
  /** Its routine is the operation's strategy's, which the strategy's select changes. */
  value: OriginParams
  /** The routine's parameters with its method on the machine: defaults, ranges and descriptions. */
  parameters: OriginSpecs
  /** Stored anchors of the plate's device that the start can be relative to. */
  anchors: readonly ProbingAnchorOption[]
  /** Receives complete, valid parameters as soon as an edit makes them valid. */
  onChange: (value: OriginParams) => void
  /** Picking its start in the 3D view; null where it cannot be picked. */
  pick?: ProbingPick | null
  disabled?: boolean
  onValidityChange?: (valid: boolean) => void
}

const CORNER_OPTIONS = PROBE_3D_CORNERS.map((value) => ({
  value,
  label: PROBE_3D_CORNER_LABELS[value],
}))
const AXES_OPTIONS = PROBE_3D_AXES.map((value) => ({
  value,
  label: PROBE_3D_AXES_LABELS[value],
}))

/** Where the form keeps each numeric input: a field, or one axis of the distance. */
type NumericPath = "distance[0]" | "distance[1]" | "depth"

/**
 * Parameters of an origin probing operation, for the routine its strategy runs: the corner of a
 * corner strategy, else the axes of a centre. Edits apply as soon as the parameters are valid;
 * invalid input stays in the form with its errors and is never passed on.
 */
export function OriginSettings({
  value,
  parameters,
  anchors,
  onChange,
  pick = null,
  disabled = false,
  onValidityChange,
}: OriginSettingsProps) {
  const draft = useProbingDraft(value, onChange)
  return (
    <OriginForm
      key={draft.key}
      value={value}
      parameters={parameters}
      anchors={anchors}
      pick={pick}
      disabled={disabled}
      onChange={draft.onChange}
      onValidityChange={onValidityChange}
    />
  )
}

function OriginForm({
  value,
  parameters,
  anchors,
  onChange,
  pick,
  disabled,
  onValidityChange,
}: Required<Omit<OriginSettingsProps, "onValidityChange">> &
  Pick<OriginSettingsProps, "onValidityChange">) {
  const id = useId()
  const schema = originParamsSchema(parameters)
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
  // A field the axes hide takes back its last valid value, as the form passes on only valid
  // parameters: a hidden error would hold back every later edit. Another strategy, and so
  // another routine, comes from outside the form, which starts over with it.
  const hide = (axes: Probe3dAxes) => {
    const shown = originFields(value.routine, axes)
    const restore = (
      path: NumericPath,
      { min, max }: ParameterSpec,
      last: number
    ) => {
      const current = form.getFieldValue(path)
      if (!(current >= min && current <= max))
        form.setFieldValue(path, last, { dontRunListeners: true })
    }
    if (!shown.distance[0])
      restore("distance[0]", parameters.distance[0], value.distance[0])
    if (!shown.distance[1])
      restore("distance[1]", parameters.distance[1], value.distance[1])
    if (!shown.depth) restore("depth", parameters.depth, value.depth)
  }
  return (
    <FieldGroup>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => {
          const shown = originFields(values.routine, values.axes)
          return (
            <FieldSet>
              <FieldLegend>
                {PROBE_3D_ROUTINE_LABELS[values.routine]}
              </FieldLegend>
              <FieldGroup className="gap-3">
                {findsCorner(values.routine) ? (
                  <Field
                    orientation="horizontal"
                    className={FIELD_LAYOUT}
                    data-disabled={disabled}
                  >
                    <FieldLabel htmlFor={`${id}-corner`}>Corner</FieldLabel>
                    {probingField(
                      form,
                      "corner"
                    )((field) => (
                      <OptionSelect
                        id={`${id}-corner`}
                        className="w-full min-w-0"
                        options={CORNER_OPTIONS}
                        value={field.value}
                        disabled={disabled}
                        onValueChange={field.onChange}
                      />
                    ))}
                  </Field>
                ) : (
                  <Field
                    orientation="horizontal"
                    className={FIELD_LAYOUT}
                    data-disabled={disabled}
                  >
                    <FieldLabel htmlFor={`${id}-axes`}>Axes</FieldLabel>
                    {probingField(
                      form,
                      "axes"
                    )((field) => (
                      <OptionSelect
                        id={`${id}-axes`}
                        className="w-full min-w-0"
                        options={AXES_OPTIONS}
                        value={field.value}
                        disabled={disabled}
                        onValueChange={(axes) => {
                          hide(axes)
                          field.onChange(axes)
                        }}
                      />
                    ))}
                  </Field>
                )}
                {shown.distance[0] && (
                  <ParameterField
                    id={`${id}-distanceX`}
                    parameter={parameters.distance[0]}
                    field={probingField(form, "distance[0]")}
                    disabled={disabled}
                  />
                )}
                {shown.distance[1] && (
                  <ParameterField
                    id={`${id}-distanceY`}
                    parameter={parameters.distance[1]}
                    field={probingField(form, "distance[1]")}
                    disabled={disabled}
                  />
                )}
                {shown.depth && (
                  <ParameterField
                    id={`${id}-depth`}
                    parameter={parameters.depth}
                    field={probingField(form, "depth")}
                    disabled={disabled}
                  />
                )}
              </FieldGroup>
            </FieldSet>
          )
        }}
      </form.Subscribe>
      <PlacementFields
        placement={probingField(form, "placement")}
        anchors={anchors}
        lastAnchor={lastAnchor}
        setLastAnchor={setLastAnchor}
        pick={pick}
        disabled={disabled}
        height
        onDraftValidityChange={
          onValidityChange
            ? (ready) => {
                setPlacementReady(ready)
                onValidityChange(ready && parametersValid)
              }
            : undefined
        }
      />
    </FieldGroup>
  )
}
