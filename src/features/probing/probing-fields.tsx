import { Fragment } from "react"
import type { ReactNode } from "react"
import type { DeepKeys, DeepValue } from "@tanstack/react-form"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { MeasurementInput } from "@/components/workspace/measurement-input"
import { Hint } from "@/components/workspace/hint"
import { ReasonButton } from "@/components/workspace/reason-button"
import { ReferencePointFields } from "@/components/workspace/reference-point-fields"
import { FIELD_LAYOUT, FULL_ROW, visibleErrors } from "./probing-form"
import type {
  FieldErrors,
  ProbingAnchorOption,
  ProbingField,
  ProbingForm,
  ProbingParameter,
} from "./probing-form"
import type {
  AnchorPlacement,
  ProbePlacement,
} from "@/domain/probing/placement"

/**
 * Adapts one field of a probing form into a `ProbingField`, so a shared field component can
 * render it without knowing the form's own shape (`ProbingField`).
 */
export function probingField<
  TParams extends Record<string, unknown>,
  TName extends DeepKeys<TParams>,
>(
  form: ProbingForm<TParams>,
  name: TName
): ProbingField<DeepValue<TParams, TName>> {
  return (render) => (
    <form.Field name={name}>
      {(field) =>
        render({
          value: field.state.value,
          errors: visibleErrors(field.state.meta),
          onChange: field.handleChange,
          onBlur: field.handleBlur,
        })
      }
    </form.Field>
  )
}

/** A labelled measurement, explained on its label, with its errors, on one row of a probing form. */
export function MeasurementField({
  id,
  label,
  description,
  axis,
  unit,
  placeholder,
  min,
  max,
  step,
  value,
  errors,
  disabled,
  onBlur,
  onValueChange,
}: {
  id: string
  label: string
  description?: string
  axis?: ProbingParameter["axis"]
  unit?: string
  placeholder?: string
  min?: number
  max?: number
  step?: number
  /** NaN or null leave the input empty. */
  value: number | null
  errors: FieldErrors
  disabled: boolean
  onBlur: () => void
  /** Null for an empty input. */
  onValueChange: (value: number | null) => void
}) {
  const invalid = !!errors?.length
  return (
    <Field
      orientation="horizontal"
      className={FIELD_LAYOUT}
      data-invalid={invalid}
      data-disabled={disabled}
    >
      <FieldLabel htmlFor={id}>
        <Hint text={description}>{label}</Hint>
      </FieldLabel>
      <MeasurementInput
        id={id}
        type="number"
        aria-description={description}
        axis={axis}
        unit={unit}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        value={value === null || Number.isNaN(value) ? "" : value}
        disabled={disabled}
        aria-invalid={invalid}
        onBlur={onBlur}
        onChange={(event) =>
          onValueChange(
            event.target.value.trim() ? Number(event.target.value) : null
          )
        }
      />
      <FieldError className={FULL_ROW} errors={errors} />
    </Field>
  )
}

/**
 * A probing form's row that places the operation over the plate's work area, or from what
 * `title` names, such as its work origin.
 */
export function WorkAreaField({
  title = "Work area",
  description,
  action,
  icon,
  reason,
  disabled,
  onApply,
}: {
  title?: string
  description: string
  action: string
  icon: ReactNode
  /** Why the action is unavailable; null enables it. */
  reason: string | null
  disabled: boolean
  onApply: () => void
}) {
  return (
    <Field orientation="horizontal" data-disabled={disabled}>
      <FieldContent>
        <FieldTitle>
          <Hint text={description}>{title}</Hint>
        </FieldTitle>
      </FieldContent>
      <ReasonButton
        label={action}
        reason={reason}
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-description={description}
        onClick={onApply}
      >
        {icon}
        {action}
      </ReasonButton>
    </Field>
  )
}

/** A boolean setting shown as a labelled row with a switch, such as a pause after probing. */
export function SwitchField({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal" data-disabled={disabled}>
      <FieldContent>
        <FieldLabel htmlFor={id}>
          <Hint text={description}>{label}</Hint>
        </FieldLabel>
      </FieldContent>
      <Switch
        id={id}
        aria-description={description}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </Field>
  )
}

/** The numeric fields of a probing form, each on its own `MeasurementField` row. */
export function NumericFields({
  id,
  disabled,
  fields,
}: {
  id: string
  disabled: boolean
  fields: readonly {
    name: string
    parameter: ProbingParameter
    field: ProbingField<number>
  }[]
}) {
  return (
    <>
      {fields.map(({ name, parameter, field }) => (
        <Fragment key={name}>
          {field(({ value, errors, onChange, onBlur }) => (
            <MeasurementField
              id={`${id}-${name}`}
              label={parameter.label}
              description={parameter.description}
              axis={parameter.axis}
              unit={parameter.unit}
              min={parameter.min}
              max={parameter.max}
              step={parameter.step}
              value={value}
              errors={errors}
              disabled={disabled}
              onBlur={onBlur}
              onValueChange={(next) => onChange(next ?? Number.NaN)}
            />
          ))}
        </Fragment>
      ))}
    </>
  )
}

const AXES = ["X", "Y", "Z"] as const
const PLANAR_AXES = ["X", "Y"] as const
const HEIGHT_AXES = ["Z"] as const

/** The probe position among the references: an ID no stored anchor has. */
const PROBE_POSITION = ""

/** A probe-position placement, with the start's height when it has one. */
function probePosition(height: number | undefined): ProbePlacement {
  if (height === undefined) return { kind: "probe-position" }
  return { kind: "probe-position", offset: { z: height } }
}

/**
 * Where a probing operation starts, edited as setup items' points are (`ReferencePointFields`):
 * relative to the probe's position, or to a stored anchor of the plate's device, from which it
 * takes X and Y. With `height`, it also takes a Z, a height on the bed, which may stay empty.
 */
export function PlacementFields({
  placement,
  anchors,
  lastAnchor,
  setLastAnchor,
  disabled,
  height = false,
  action,
}: {
  placement: ProbingField<ProbePlacement>
  anchors: readonly ProbingAnchorOption[]
  /** The last anchor placement, kept so switching back from the probe position restores it. */
  lastAnchor: AnchorPlacement | null
  setLastAnchor: (anchor: AnchorPlacement | null) => void
  disabled: boolean
  /** The operation starts at a height on the bed, such as 3D probing. */
  height?: boolean
  /** Fit grid or Center, above the start; left out where it sits beside other fields instead. */
  action?: (
    placement: ProbePlacement,
    setPlacement: (next: ProbePlacement) => void
  ) => ReactNode
}) {
  const anchorAxes = height ? AXES : PLANAR_AXES
  return placement(({ value, onChange: setPlacement }) => {
    const anchorId = value.kind === "anchor" ? value.anchorId : PROBE_POSITION
    const references = [
      {
        value: PROBE_POSITION,
        label: "Probe position",
        axes: height ? HEIGHT_AXES : [],
      },
      ...anchors.map(({ id, name }) => ({
        value: id,
        label: name,
        axes: anchorAxes,
      })),
      ...(anchorId && !anchors.some(({ id }) => id === anchorId)
        ? [{ value: anchorId, label: "Unavailable anchor", axes: anchorAxes }]
        : []),
    ]
    const z = value.offset?.z
    // The height is always passed: an emptied Z is undefined, which must clear it.
    const toAnchor = (
      id: string,
      x: number,
      y: number,
      h: number | undefined
    ) =>
      setPlacement({
        kind: "anchor",
        anchorId: id,
        offset: h === undefined ? { x, y } : { x, y, z: h },
      })
    return (
      <FieldSet>
        <FieldLegend>Placement</FieldLegend>
        <FieldGroup className="gap-3">
          {action?.(value, setPlacement)}
          <ReferencePointFields
            label="Placement"
            references={references}
            reference={anchorId}
            point={
              value.kind === "anchor"
                ? { X: value.offset.x, Y: value.offset.y, Z: z }
                : { Z: z }
            }
            optional={HEIGHT_AXES}
            disabled={disabled}
            onReferenceChange={(reference) => {
              if (reference === PROBE_POSITION) {
                if (value.kind === "anchor") setLastAnchor(value)
                setPlacement(probePosition(z))
                return
              }
              const { x, y } =
                value.kind === "anchor"
                  ? value.offset
                  : (lastAnchor?.offset ?? { x: 0, y: 0 })
              toAnchor(reference, x, y, z)
            }}
            onPointChange={({ X = 0, Y = 0, Z }) => {
              if (value.kind === "anchor") toAnchor(value.anchorId, X, Y, Z)
              else setPlacement(probePosition(Z))
            }}
          />
        </FieldGroup>
      </FieldSet>
    )
  })
}
