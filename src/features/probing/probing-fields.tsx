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
import { OptionSelect } from "@/components/option-select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MeasurementInput } from "@/components/workspace/measurement-input"
import { Hint } from "@/components/workspace/hint"
import { ReasonButton } from "@/components/workspace/reason-button"
import { AUTO_LEVEL_COORDINATE_LIMIT } from "@/domain/auto-level/params"
import type {
  AnchorPlacement,
  AutoLevelPlacement,
} from "@/domain/auto-level/params"
import {
  FIELD_LAYOUT,
  FULL_ROW,
  anchorPlacement,
  visibleErrors,
} from "./probing-form"
import type {
  FieldErrors,
  ProbingAnchorOption,
  ProbingField,
  ProbingForm,
  ProbingParameter,
} from "./probing-form"

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

/**
 * Where a probing operation places itself: a stored anchor plus an offset, or the probe
 * position. Shared by auto-level's grid, auto Z-height's touch point and 3D probing's start: the
 * anchor items, `canUseAnchor`, `choose`, the anchor Select and the offsets are identical; only
 * the "Relative to" wording and, through `action`, what fits the placement to the work area (Fit
 * grid or Center) differ.
 */
export function PlacementFields({
  id,
  placement,
  anchorId: anchorIdField,
  offsetX,
  offsetY,
  anchors,
  lastAnchor,
  setLastAnchor,
  disabled,
  probeDescription,
  anchorDescription,
  action,
}: {
  id: string
  placement: ProbingField<AutoLevelPlacement>
  anchorId: ProbingField<string>
  offsetX: ProbingField<number>
  offsetY: ProbingField<number>
  anchors: readonly ProbingAnchorOption[]
  /** The last anchor placement, kept so switching back from the probe position restores it. */
  lastAnchor: AnchorPlacement | null
  setLastAnchor: (anchor: AnchorPlacement | null) => void
  disabled: boolean
  /** What "Probe position" does, explained on "Relative to" while it is chosen. */
  probeDescription: string
  /** What "Stored anchor" does, explained on "Relative to" while it is chosen. */
  anchorDescription: string
  /** Fit grid or Center, above "Relative to"; left out where it sits beside other fields instead. */
  action?: (
    placement: AutoLevelPlacement,
    setPlacement: (next: AutoLevelPlacement) => void
  ) => ReactNode
}) {
  return placement(({ value: placementValue, onChange: setPlacement }) => {
    const anchorId =
      placementValue.kind === "anchor" ? placementValue.anchorId : ""
    const anchorItems = [
      ...anchors.map((anchor) => ({ value: anchor.id, label: anchor.name })),
      ...(anchorId && !anchors.some((anchor) => anchor.id === anchorId)
        ? [{ value: anchorId, label: "Unavailable anchor" }]
        : []),
    ]
    const canUseAnchor =
      placementValue.kind === "anchor" ||
      lastAnchor !== null ||
      anchors.length > 0
    const relativeToDescription =
      placementValue.kind === "anchor" ? anchorDescription : probeDescription
    const choose = (kind: string | undefined) => {
      if (kind === "probe-position" && placementValue.kind === "anchor") {
        setLastAnchor(placementValue)
        setPlacement({ kind: "probe-position" })
      }
      if (kind === "anchor" && placementValue.kind === "probe-position") {
        const next =
          lastAnchor ?? (anchors.length ? anchorPlacement(anchors[0].id) : null)
        if (next) setPlacement(next)
      }
    }
    return (
      <FieldSet>
        <FieldLegend>Placement</FieldLegend>
        <FieldGroup className="gap-3">
          {action?.(placementValue, setPlacement)}
          <Field data-disabled={disabled}>
            <FieldLabel id={`${id}-relative-to`}>
              <Hint text={relativeToDescription}>Relative to</Hint>
            </FieldLabel>
            <ToggleGroup
              variant="outline"
              className="w-full"
              aria-labelledby={`${id}-relative-to`}
              aria-description={relativeToDescription}
              value={[placementValue.kind]}
              disabled={disabled}
              onValueChange={(values) => choose(values[0])}
            >
              <ToggleGroupItem value="probe-position" className="flex-1">
                Probe position
              </ToggleGroupItem>
              <ToggleGroupItem
                value="anchor"
                className="flex-1"
                disabled={!canUseAnchor}
              >
                Stored anchor
              </ToggleGroupItem>
            </ToggleGroup>
          </Field>
          {placementValue.kind === "anchor" && (
            <>
              {anchorIdField(({ value, errors, onChange }) => (
                <Field
                  orientation="horizontal"
                  className={FIELD_LAYOUT}
                  data-invalid={!!errors?.length}
                  data-disabled={disabled}
                >
                  <FieldLabel htmlFor={`${id}-anchor`}>Anchor</FieldLabel>
                  <OptionSelect
                    id={`${id}-anchor`}
                    className="w-full min-w-0"
                    options={anchorItems}
                    value={value}
                    disabled={disabled}
                    aria-invalid={!!errors?.length}
                    onValueChange={(next) => onChange(next)}
                  />
                  <FieldError className={FULL_ROW} errors={errors} />
                </Field>
              ))}
              {offsetX(({ value, errors, onChange, onBlur }) => (
                <MeasurementField
                  id={`${id}-offset-x`}
                  label="Offset X"
                  axis="X"
                  unit="mm"
                  min={-AUTO_LEVEL_COORDINATE_LIMIT}
                  max={AUTO_LEVEL_COORDINATE_LIMIT}
                  value={value}
                  errors={errors}
                  disabled={disabled}
                  onBlur={onBlur}
                  onValueChange={(next) => onChange(next ?? Number.NaN)}
                />
              ))}
              {offsetY(({ value, errors, onChange, onBlur }) => (
                <MeasurementField
                  id={`${id}-offset-y`}
                  label="Offset Y"
                  axis="Y"
                  unit="mm"
                  min={-AUTO_LEVEL_COORDINATE_LIMIT}
                  max={AUTO_LEVEL_COORDINATE_LIMIT}
                  value={value}
                  errors={errors}
                  disabled={disabled}
                  onBlur={onBlur}
                  onValueChange={(next) => onChange(next ?? Number.NaN)}
                />
              ))}
            </>
          )}
        </FieldGroup>
      </FieldSet>
    )
  })
}
