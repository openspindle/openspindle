import { useId } from "react"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { Hint } from "@/components/workspace/hint"
import { formatMillimetres } from "@/domain/geometry/millimetres"
import { OutlineParamsSchema } from "@/domain/probing/tasks/outline/params"
import type {
  OutlineParams,
  OutlineSpecs,
} from "@/domain/probing/tasks/outline/params"
import { roundOutward } from "@/domain/compile/toolpath-bounds"
import type { ToolpathBoundsResult } from "@/domain/compile/toolpath-bounds"
import { rangedSchema } from "@/domain/probing/parameters"
import {
  ParameterField,
  SwitchField,
  probingField,
} from "@/features/probing/probing-fields"
import {
  useProbingDraft,
  useProbingForm,
} from "@/features/probing/probing-form"

export type OutlineSettingsProps = {
  value: OutlineParams
  /** The trace's parameters with its strategy on the plate's machine: defaults, ranges and descriptions. */
  parameters: OutlineSpecs
  /** What the trace follows: the plate's toolpath bounds, or why there are none. */
  outline: ToolpathBoundsResult
  /** Receives complete, valid parameters as soon as an edit makes them valid. */
  onChange: (value: OutlineParams) => void
  disabled?: boolean
}

/** The traced rectangle in work coordinates, or why there is nothing to trace. */
function outlineDescription(outline: ToolpathBoundsResult) {
  if (!outline.ok) return `Nothing to trace: ${outline.reason}`
  const { min, max } = roundOutward(outline.bounds)
  const [x0, y0, x1, y1] = [min[0], min[1], max[0], max[1]].map(
    formatMillimetres
  )
  return `Traces X ${x0} to ${x1} and Y ${y0} to ${y1} mm from the work origin: where the plate's machining cuts, outlined in the 3D view.`
}

/**
 * Parameters of an outline probing operation. Edits apply as soon as the parameters are valid;
 * invalid input stays in the form with its errors and is never passed on.
 */
export function OutlineSettings({
  value,
  parameters,
  outline,
  onChange,
  disabled = false,
}: OutlineSettingsProps) {
  const draft = useProbingDraft(value, onChange)
  return (
    <OutlineForm
      key={draft.key}
      value={value}
      parameters={parameters}
      outline={outline}
      disabled={disabled}
      onChange={draft.onChange}
    />
  )
}

function OutlineForm({
  value,
  parameters,
  outline,
  onChange,
  disabled,
}: Required<OutlineSettingsProps>) {
  const id = useId()
  const schema = rangedSchema(OutlineParamsSchema, parameters)
  const form = useProbingForm(value, schema, onChange)

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>
          <Hint text={outlineDescription(outline)}>Outline</Hint>
        </FieldLegend>
        <FieldGroup className="gap-3">
          <ParameterField
            id={`${id}-travelZ`}
            parameter={parameters.travelZ}
            field={probingField(form, "travelZ")}
            disabled={disabled}
          />
          <ParameterField
            id={`${id}-feed`}
            parameter={parameters.feed}
            field={probingField(form, "feed")}
            disabled={disabled}
          />
        </FieldGroup>
      </FieldSet>
      <form.Field name="pauseAfterScan">
        {(field) => (
          <SwitchField
            id={`${id}-pause`}
            label="Pause after tracing"
            description="Pause after the trace to check the outline against the stock and fixtures, then Resume or Stop."
            checked={field.state.value}
            disabled={disabled}
            onCheckedChange={(checked) => field.handleChange(checked)}
          />
        )}
      </form.Field>
    </FieldGroup>
  )
}
