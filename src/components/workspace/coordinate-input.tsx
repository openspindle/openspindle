import { useEffect, useId, useRef, useState } from "react"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { COORDINATE_LIMIT, toMicrometre } from "@/domain/primitives"
import type { Point3 } from "@/domain/nc/gcode"
import { MeasurementInput } from "./measurement-input"
import type { MeasurementAxis } from "./measurement-input"

/** Coordinates are shown and typed to three decimals: a micrometre, a thousandth of a degree. */
const rounded = toMicrometre

/**
 * A measurement committed on blur or Enter, to three decimals and within `min` and `max`;
 * Escape restores the stored value. A value left as shown keeps the stored one, however many
 * decimals it has. Coordinates and sizes alike are typed through it. With `onClear`, it may be
 * left empty: null shows empty, and emptying it clears it.
 */
export function BoundedMeasurementInput({
  id,
  axis,
  unit,
  label,
  value,
  min = -COORDINATE_LIMIT,
  max = COORDINATE_LIMIT,
  disabled,
  onCommit,
  onClear,
  onDraftValidityChange,
}: {
  id: string
  axis: MeasurementAxis
  unit: string
  label: string
  value: number | null
  min?: number
  max?: number
  disabled?: boolean
  onCommit: (value: number) => void
  onClear?: () => void
  /** Opt-in transactional forms retain invalid text and wait for valid blur/Enter commits. */
  onDraftValidityChange?: (ready: boolean) => void
}) {
  const shown = value === null ? "" : String(rounded(value))
  const [draft, setDraft] = useState(shown)
  const canceled = useRef(false)
  const draftListener = useRef(onDraftValidityChange)
  draftListener.current = onDraftValidityChange
  useEffect(() => {
    setDraft(shown)
    draftListener.current?.(true)
  }, [shown])
  const parsed = rounded(Number(draft))
  const draftValid = draft.trim()
    ? Number.isFinite(parsed) && parsed >= min && parsed <= max
    : onClear !== undefined
  return (
    <>
      <MeasurementInput
        id={id}
        axis={axis}
        unit={unit}
        aria-label={label}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        aria-invalid={onDraftValidityChange && !draftValid}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          onDraftValidityChange?.(next === shown)
        }}
        onBlur={() => {
          const next = rounded(Number(draft))
          const cleared = !canceled.current && !draft.trim() && onClear
          if (cleared) {
            if (value !== null) onClear()
            onDraftValidityChange?.(true)
          } else if (
            !canceled.current &&
            draft.trim() &&
            Number.isFinite(next) &&
            next >= min &&
            next <= max
          ) {
            setDraft(String(next))
            if (String(next) !== shown) onCommit(next)
            onDraftValidityChange?.(true)
          } else if (canceled.current || !onDraftValidityChange) {
            setDraft(shown)
            onDraftValidityChange?.(true)
          } else onDraftValidityChange(false)
          canceled.current = false
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") {
            canceled.current = true
            event.currentTarget.blur()
          }
        }}
      />
      {onDraftValidityChange && !draftValid && (
        <FieldError>
          Enter a number from {min} to {max}
          {onClear ? ", or leave empty." : "."}
        </FieldError>
      )}
    </>
  )
}

/**
 * A coordinate, as its own field with a hidden label, within the ±10 m limit; with `onClear`, it
 * may be left empty.
 */
export function CoordinateInput({
  axis,
  unit,
  label,
  value,
  disabled,
  title,
  onCommit,
  onClear,
  onDraftValidityChange,
}: {
  axis: MeasurementAxis
  unit: string
  label: string
  value: number | null
  disabled?: boolean
  /** Hover text for the whole field, which a disabled input would not show. */
  title?: string
  onCommit: (value: number) => void
  onClear?: () => void
  onDraftValidityChange?: (ready: boolean) => void
}) {
  const id = useId()
  return (
    <Field data-disabled={disabled} title={title}>
      <FieldLabel className="sr-only" htmlFor={id}>
        {label}
      </FieldLabel>
      <BoundedMeasurementInput
        id={id}
        axis={axis}
        unit={unit}
        label={label}
        value={value}
        disabled={disabled}
        onCommit={onCommit}
        onClear={onClear}
        onDraftValidityChange={onDraftValidityChange}
      />
    </Field>
  )
}

/** X, Y and Z of a point, each committed on its own. */
export function PointFields({
  label,
  value,
  unit = "mm",
  disabled,
  zLock,
  onChange,
}: {
  label: string
  value: Point3
  unit?: string
  disabled?: boolean
  /** Why Z is fixed, shown on its field; absent while Z can be edited. */
  zLock?: string
  onChange: (value: Point3) => void
}) {
  return (
    <FieldGroup className="gap-3">
      {(["X", "Y", "Z"] as const).map((axis, index) => (
        <CoordinateInput
          key={axis}
          axis={axis}
          unit={unit}
          label={`${label} ${axis}`}
          value={value[index]}
          disabled={disabled || (axis === "Z" && zLock !== undefined)}
          title={axis === "Z" ? zLock : undefined}
          onCommit={(number) => {
            const next: Point3 = [...value]
            next[index] = number
            onChange(next)
          }}
        />
      ))}
    </FieldGroup>
  )
}

/** A labelled point: a legend over its X, Y and Z fields. */
export function PointFieldSet(props: Parameters<typeof PointFields>[0]) {
  return (
    <FieldSet>
      <FieldLegend>{props.label}</FieldLegend>
      <PointFields {...props} />
    </FieldSet>
  )
}
