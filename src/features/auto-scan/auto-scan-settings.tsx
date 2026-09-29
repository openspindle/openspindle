import { useId } from "react"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import { Hint } from "@/components/workspace/hint"
import { formatMillimetres } from "@/domain/auto-level/params"
import {
  AUTO_SCAN_FIELDS,
  autoScanParamsSchema,
} from "@/domain/auto-scan/params"
import type {
  AutoScanParameters,
  AutoScanParams,
} from "@/domain/auto-scan/params"
import { roundOutward } from "@/domain/compile/toolpath-bounds"
import type { ToolpathBoundsResult } from "@/domain/compile/toolpath-bounds"
import {
  NumericFields,
  SwitchField,
  probingField,
} from "@/features/probing/probing-fields"
import {
  useProbingDraft,
  useProbingForm,
} from "@/features/probing/probing-form"

export type AutoScanSettingsProps = {
  value: AutoScanParams
  /** The trace's parameters on the machine's probe: defaults, ranges and descriptions. */
  parameters: AutoScanParameters
  /** What the scan traces: the plate's toolpath bounds, or why there are none. */
  outline: ToolpathBoundsResult
  /** Receives complete, valid parameters as soon as an edit makes them valid. */
  onChange: (value: AutoScanParams) => void
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
 * Parameters of a built-in auto-scan operation. Edits apply as soon as the parameters are valid;
 * invalid input stays in the form with its errors and is never passed on.
 */
export function AutoScanSettings({
  value,
  parameters,
  outline,
  onChange,
  disabled = false,
}: AutoScanSettingsProps) {
  const draft = useProbingDraft(value, onChange)
  return (
    <AutoScanForm
      key={draft.key}
      value={value}
      parameters={parameters}
      outline={outline}
      disabled={disabled}
      onChange={draft.onChange}
    />
  )
}

function AutoScanForm({
  value,
  parameters,
  outline,
  onChange,
  disabled,
}: Required<AutoScanSettingsProps>) {
  const id = useId()
  const schema = autoScanParamsSchema(parameters)
  const form = useProbingForm(value, schema, onChange)

  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>
          <Hint text={outlineDescription(outline)}>Outline</Hint>
        </FieldLegend>
        <FieldGroup className="gap-3">
          <NumericFields
            id={id}
            disabled={disabled}
            fields={AUTO_SCAN_FIELDS.map((name) => ({
              name,
              parameter: parameters[name],
              field: probingField(form, name),
            }))}
          />
        </FieldGroup>
      </FieldSet>
      <form.Field name="pauseAfterScan">
        {(field) => (
          <SwitchField
            id={`${id}-pause`}
            label="Pause after scanning"
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
