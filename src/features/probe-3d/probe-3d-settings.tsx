import { useId, useState } from "react"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { Hint } from "@/components/workspace/hint"
import {
  PROBE_3D_AXES,
  PROBE_3D_AXES_LABELS,
  PROBE_3D_CORNERS,
  PROBE_3D_CORNER_LABELS,
  PROBE_3D_ROUTINES,
  PROBE_3D_ROUTINE_LABELS,
  findsCorner,
  probe3dFields,
  probe3dParamsSchema,
} from "@/domain/probe-3d/params"
import type {
  Probe3dAxes,
  Probe3dSpecs,
  Probe3dParams,
  Probe3dRoutine,
} from "@/domain/probe-3d/params"
import {
  NumericFields,
  PlacementFields,
  probingField,
} from "@/features/probing/probing-fields"
import {
  FIELD_LAYOUT,
  useProbingDraft,
  useProbingForm,
} from "@/features/probing/probing-form"
import type { ProbingAnchorOption } from "@/features/probing/probing-form"
import type { ParameterSpec } from "@/domain/probing/parameters"
import type { AnchorPlacement } from "@/domain/probing/placement"

export type Probe3dSettingsProps = {
  value: Probe3dParams
  /** The routine's parameters on the machine's 3D probe: defaults, ranges and descriptions. */
  parameters: Probe3dSpecs
  /** Stored anchors of the plate's device that the start can be relative to. */
  anchors: readonly ProbingAnchorOption[]
  /** Receives complete, valid parameters as soon as an edit makes them valid. */
  onChange: (value: Probe3dParams) => void
  disabled?: boolean
}

const ROUTINE_OPTIONS = PROBE_3D_ROUTINES.map((value) => ({
  value,
  label: PROBE_3D_ROUTINE_LABELS[value],
}))
const CORNER_OPTIONS = PROBE_3D_CORNERS.map((value) => ({
  value,
  label: PROBE_3D_CORNER_LABELS[value],
}))
const AXES_OPTIONS = PROBE_3D_AXES.map((value) => ({
  value,
  label: PROBE_3D_AXES_LABELS[value],
}))

/** Where the form keeps each numeric input: a field, or one axis of the distance. */
type NumericPath = "ballDiameter" | "distance[0]" | "distance[1]" | "depth"

/** What the routine touches and sets. */
function routineDescription({ routine }: Probe3dParams) {
  switch (routine) {
    case "outside-corner":
      return "Touches the top, then the two sides at the corner, of the stock or anything else on the bed, and sets work X0 Y0 at the corner and Z0 on the top."
    case "inside-corner":
      return "Touches the top outside an inside corner, such as a pocket's or a bracket's, then its two walls, and sets work X0 Y0 at the corner and Z0 on the top."
    case "pocket-center":
      return "Touches the walls either side of a pocket or bore, from inside it, and sets work X0 Y0 midway between them."
    case "boss-center":
      return "Touches the top of a boss, such as the stock or a dowel pin, then its sides either side, and sets work X0 Y0 midway between them and Z0 on the top."
  }
}

/**
 * Parameters of a built-in 3D probing operation. Edits apply as soon as the parameters are
 * valid; invalid input stays in the form with its errors and is never passed on.
 */
export function Probe3dSettings({
  value,
  parameters,
  anchors,
  onChange,
  disabled = false,
}: Probe3dSettingsProps) {
  const draft = useProbingDraft(value, onChange)
  return (
    <Probe3dForm
      key={draft.key}
      value={value}
      parameters={parameters}
      anchors={anchors}
      disabled={disabled}
      onChange={draft.onChange}
    />
  )
}

function Probe3dForm({
  value,
  parameters,
  anchors,
  onChange,
  disabled,
}: Required<Probe3dSettingsProps>) {
  const id = useId()
  const schema = probe3dParamsSchema(parameters)
  // Switching back from the probe position restores the anchor settings.
  const [lastAnchor, setLastAnchor] = useState<AnchorPlacement | null>(null)
  const form = useProbingForm(value, schema, onChange)
  // A field the routine or its axes hide takes back its last valid value, as the form passes on
  // only valid parameters: a hidden error would hold back every later edit.
  const hide = (routine: Probe3dRoutine, axes: Probe3dAxes) => {
    const shown = probe3dFields(routine, axes)
    const restore = (
      path: NumericPath,
      { min, max }: ParameterSpec,
      last: number
    ) => {
      const current = form.getFieldValue(path)
      if (!(current >= min && current <= max))
        form.setFieldValue(path, last, { dontRunListeners: true })
    }
    if (!shown.ballDiameter)
      restore("ballDiameter", parameters.ballDiameter, value.ballDiameter)
    if (!shown.distance[0])
      restore("distance[0]", parameters.distance[0], value.distance[0])
    if (!shown.distance[1])
      restore("distance[1]", parameters.distance[1], value.distance[1])
    if (!shown.depth) restore("depth", parameters.depth, value.depth)
  }
  // The numeric inputs the routine reads, by the names their IDs end in.
  const numericFields = ({ routine, axes }: Probe3dParams) => {
    const shown = probe3dFields(routine, axes)
    const input = (
      name: string,
      parameter: ParameterSpec,
      path: NumericPath
    ) => ({
      name,
      parameter,
      field: probingField(form, path),
    })
    return [
      ...(shown.ballDiameter
        ? [input("ballDiameter", parameters.ballDiameter, "ballDiameter")]
        : []),
      ...(shown.distance[0]
        ? [input("distanceX", parameters.distance[0], "distance[0]")]
        : []),
      ...(shown.distance[1]
        ? [input("distanceY", parameters.distance[1], "distance[1]")]
        : []),
      ...(shown.depth ? [input("depth", parameters.depth, "depth")] : []),
    ]
  }

  return (
    <FieldGroup>
      <form.Subscribe selector={(state) => state.values}>
        {(values) => (
          <FieldSet>
            <FieldLegend>Routine</FieldLegend>
            <FieldGroup className="gap-3">
              <Field
                orientation="horizontal"
                className={FIELD_LAYOUT}
                data-disabled={disabled}
              >
                <FieldLabel htmlFor={`${id}-routine`}>
                  <Hint text={routineDescription(values)}>Finds</Hint>
                </FieldLabel>
                {probingField(
                  form,
                  "routine"
                )((field) => (
                  <OptionSelect
                    id={`${id}-routine`}
                    className="w-full min-w-0"
                    options={ROUTINE_OPTIONS}
                    value={field.value}
                    disabled={disabled}
                    aria-description={routineDescription(values)}
                    onValueChange={(routine) => {
                      hide(routine, values.axes)
                      field.onChange(routine)
                    }}
                  />
                ))}
              </Field>
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
                        hide(values.routine, axes)
                        field.onChange(axes)
                      }}
                    />
                  ))}
                </Field>
              )}
              <NumericFields
                id={id}
                disabled={disabled}
                fields={numericFields(values)}
              />
            </FieldGroup>
          </FieldSet>
        )}
      </form.Subscribe>
      <PlacementFields
        placement={probingField(form, "placement")}
        anchors={anchors}
        lastAnchor={lastAnchor}
        setLastAnchor={setLastAnchor}
        disabled={disabled}
        height
      />
    </FieldGroup>
  )
}
