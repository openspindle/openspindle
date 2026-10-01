import { useId } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { Hint } from "@/components/workspace/hint"
import { formatMillimetres } from "@/domain/geometry/millimetres"
import { EDGE_SIDES, edgeKey, sameEdge } from "@/domain/plate/item-edges"
import type { ItemEdge, ItemEdgeRef } from "@/domain/plate/item-edges"
import { OutlineParamsSchema } from "@/domain/probing/tasks/outline/params"
import type {
  OutlineParams,
  OutlineSpecs,
  OutlineTarget,
} from "@/domain/probing/tasks/outline/params"
import { roundOutward } from "@/domain/compile/toolpath-bounds"
import type { ToolpathBoundsResult } from "@/domain/compile/toolpath-bounds"
import { rangedSchema } from "@/domain/probing/parameters"
import {
  ParameterField,
  PickButton,
  SwitchField,
  probingField,
} from "@/features/probing/probing-fields"
import type { ProbingPick } from "@/features/probing/probing-fields"
import {
  useProbingDraft,
  useProbingForm,
} from "@/features/probing/probing-form"

export type OutlineSettingsProps = {
  value: OutlineParams
  /** The trace's parameters with its strategy on the plate's machine: defaults, ranges and descriptions. */
  parameters: OutlineSpecs
  /** The plate's toolpath bounds, or why there are none. */
  outline: ToolpathBoundsResult
  /** The edges of the plate's stock and fixtures it can trace, which name the chosen ones. */
  edges: readonly ItemEdge[]
  /** Whether the plate has stock, whose outline it can trace. */
  hasStock: boolean
  /** Picking edges in the 3D view; null where they cannot be picked. */
  pick?: ProbingPick | null
  /** Receives complete, valid parameters as soon as an edit makes them valid. */
  onChange: (value: OutlineParams) => void
  disabled?: boolean
}

const TOOLPATH: OutlineTarget = { kind: "toolpath" }

/** The stock's four top edges. */
const STOCK_OUTLINE: readonly ItemEdgeRef[] = EDGE_SIDES.map((side) => ({
  item: { kind: "stock" },
  side,
}))

const TRACE_HINT =
  "Toolpath bounds: the rectangle the plate's machining cuts, from the work origin. Edges: chosen edges of the stock and fixtures, where the plate's setup puts them, from the device's first anchor, with or without machining."

const EDGES_DESCRIPTION =
  "Traces the chosen edges where the plate's setup puts them, in machine coordinates from the device's first anchor, whatever work X and Y are."

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
  edges,
  hasStock,
  pick = null,
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
      edges={edges}
      hasStock={hasStock}
      pick={pick}
      disabled={disabled}
      onChange={draft.onChange}
    />
  )
}

function OutlineForm({
  value,
  parameters,
  outline,
  edges,
  hasStock,
  pick,
  onChange,
  disabled,
}: Required<OutlineSettingsProps>) {
  const id = useId()
  const schema = rangedSchema(OutlineParamsSchema, parameters)
  const form = useProbingForm(value, schema, onChange)
  const labelOf = (ref: ItemEdgeRef) =>
    edges.find((edge) => sameEdge(edge.ref, ref))?.label ??
    `Missing edge · ${ref.side}`

  return (
    <FieldGroup>
      <form.Field name="target">
        {(field) => {
          const target = field.state.value ?? TOOLPATH
          const traced = target.kind === "edges" ? target.edges : []
          const trace = (next: readonly ItemEdgeRef[]) =>
            field.handleChange({ kind: "edges", edges: [...next] })
          return (
            <FieldSet>
              <FieldLegend>
                <Hint
                  text={
                    target.kind === "edges"
                      ? EDGES_DESCRIPTION
                      : outlineDescription(outline)
                  }
                >
                  Outline
                </Hint>
              </FieldLegend>
              <FieldGroup className="gap-3">
                <Field orientation="horizontal">
                  <FieldLabel htmlFor={`${id}-target`} className="shrink-0">
                    <Hint text={TRACE_HINT}>Trace</Hint>
                  </FieldLabel>
                  <OptionSelect
                    id={`${id}-target`}
                    aria-description={TRACE_HINT}
                    className="min-w-0 flex-1"
                    options={[
                      { value: "toolpath", label: "Toolpath bounds" },
                      { value: "edges", label: "Edges" },
                    ]}
                    value={target.kind}
                    disabled={disabled}
                    onValueChange={(kind) =>
                      field.handleChange(
                        kind === "edges"
                          ? { kind: "edges", edges: [...traced] }
                          : TOOLPATH
                      )
                    }
                  />
                </Field>
                {target.kind === "edges" && (
                  <>
                    {traced.length > 0 && (
                      <ul className="flex flex-col" aria-label="Traced edges">
                        {traced.map((ref) => (
                          <li
                            key={edgeKey(ref)}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="truncate">{labelOf(ref)}</span>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove ${labelOf(ref)}`}
                              title={`Remove ${labelOf(ref)}`}
                              disabled={disabled}
                              onClick={() =>
                                trace(
                                  traced.filter((item) => !sameEdge(item, ref))
                                )
                              }
                            >
                              <X />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {pick && (
                        <PickButton
                          pick={pick}
                          label="Pick edges"
                          disabled={disabled}
                        />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled || !hasStock}
                        title={hasStock ? undefined : "The plate has no stock."}
                        onClick={() => trace(STOCK_OUTLINE)}
                      >
                        Stock outline
                      </Button>
                    </div>
                  </>
                )}
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
          )
        }}
      </form.Field>
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
