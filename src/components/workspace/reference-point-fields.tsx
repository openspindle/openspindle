import { useId, useRef } from "react"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { CoordinateInput } from "./coordinate-input"
import type { MeasurementAxis } from "./measurement-input"

/** What a point is given relative to, and the axes it is given in from there. */
export type PointReference = {
  readonly value: string
  readonly label: string
  /** The point's axes from this reference; the others are the reference's own. */
  readonly axes: readonly MeasurementAxis[]
}

/** A point's coordinates from its reference, by axis; an optional axis may have none. */
export type ReferencePoint = Partial<Record<MeasurementAxis, number>>

/**
 * A point given relative to a reference: the reference, where there is a choice, then the
 * point's coordinates from it on the axes that reference takes. It edits what its owner maps to
 * and from its own model, such as a setup item's point relative to a stored anchor, or where a
 * probing operation starts.
 */
export function ReferencePointFields({
  label,
  references,
  reference,
  point,
  optional = [],
  locks = {},
  disabled,
  onReferenceChange,
  onPointChange,
  onDraftValidityChange,
}: {
  /** What the point is, as accessible names say it: "{label} relative to", "{label} X". */
  label: string
  references: readonly PointReference[]
  reference: string
  point: ReferencePoint
  /** Axes that may be left empty. */
  optional?: readonly MeasurementAxis[]
  /** Axes that are fixed, and why. */
  locks?: Partial<Record<MeasurementAxis, string>>
  disabled?: boolean
  onReferenceChange: (reference: string) => void
  onPointChange: (point: ReferencePoint) => void
  onDraftValidityChange?: (ready: boolean) => void
}) {
  const id = useId()
  const axes = references.find((item) => item.value === reference)?.axes ?? []
  const drafts = useRef<Partial<Record<MeasurementAxis, boolean>>>({})
  const set = (axis: MeasurementAxis, value: number | undefined) => {
    const next = { ...point }
    if (value === undefined) delete next[axis]
    else next[axis] = value
    onPointChange(next)
  }
  return (
    <>
      {references.length > 1 && (
        <Field
          orientation="horizontal"
          className="grid grid-cols-2 items-center gap-3"
          data-disabled={disabled}
        >
          <FieldLabel htmlFor={`${id}-reference`}>Relative to</FieldLabel>
          <OptionSelect
            id={`${id}-reference`}
            className="w-full min-w-0"
            aria-label={`${label} relative to`}
            options={references}
            value={reference}
            disabled={disabled}
            onValueChange={(next) => {
              drafts.current = {}
              onDraftValidityChange?.(true)
              onReferenceChange(next)
            }}
          />
        </Field>
      )}
      {axes.length > 0 && (
        <FieldGroup className="gap-3">
          {axes.map((axis) => (
            <CoordinateInput
              key={onDraftValidityChange ? `${reference}:${axis}` : axis}
              axis={axis}
              unit="mm"
              label={`${label} ${axis}`}
              value={point[axis] ?? null}
              disabled={disabled || locks[axis] !== undefined}
              title={locks[axis]}
              onCommit={(value) => set(axis, value)}
              onDraftValidityChange={
                onDraftValidityChange
                  ? (ready) => {
                      drafts.current[axis] = ready
                      onDraftValidityChange(
                        axes.every((item) => drafts.current[item] !== false)
                      )
                    }
                  : undefined
              }
              onClear={
                optional.includes(axis) ? () => set(axis, undefined) : undefined
              }
            />
          ))}
        </FieldGroup>
      )}
    </>
  )
}
