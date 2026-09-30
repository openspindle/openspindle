import { useState } from "react"
import type { ComponentProps, ReactNode } from "react"
import { evaluate, useForm } from "@tanstack/react-form"
import type { z } from "zod"
import type { FieldError } from "@/components/ui/field"
import { formatMillimetres } from "@/domain/geometry/millimetres"
import type { BedAnchor } from "@/domain/anchors/stored-anchors"
import type { BedXY, WorkAreaResult } from "@/domain/compile/toolpath-bounds"

/** A stored anchor a probing operation's placement can be relative to. */
export type ProbingAnchorOption = { id: string; name: string }

/** Where the plate cuts, for fitting a probing operation to it. */
export type WorkAreaFit = {
  result: WorkAreaResult
  /** The plate's work origin on the bed; the work area is shown relative to it. */
  origin: BedXY
  /** The plate device's anchors on the bed, which a fitted placement is relative to. */
  anchors: readonly BedAnchor[]
}

/** A bed position as work coordinates, relative to the plate's work origin. */
export const fromWorkOrigin = (point: BedXY, origin: BedXY) =>
  [0, 1].map((axis) => formatMillimetres(point[axis] - origin[axis]))

export type FieldErrors = ComponentProps<typeof FieldError>["errors"]
type FieldMeta = { isTouched: boolean; isValid: boolean; errors: FieldErrors }

export const FIELD_LAYOUT =
  "grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] items-center"
export const FULL_ROW = "col-span-2"

/** Errors show once the user has edited the field. */
export const visibleErrors = (meta: FieldMeta): FieldErrors =>
  meta.isTouched && !meta.isValid ? meta.errors : []

/**
 * `useForm` plus the schema listener every probing form needs: listeners run before validation,
 * so the schema decides here, on every change, what may leave the form as `onChange`. Invalid
 * input stays in the form with its errors and is never passed on.
 */
export function useProbingForm<TParams extends Record<string, unknown>>(
  value: TParams,
  schema: z.ZodType<TParams, TParams>,
  onChange: (value: TParams) => void
) {
  return useForm({
    defaultValues: value,
    validators: { onChange: schema },
    listeners: {
      onChange: ({ formApi }) => {
        const parsed = schema.safeParse(formApi.state.values)
        if (parsed.success && !evaluate(parsed.data, value))
          onChange(parsed.data)
      },
    },
  })
}

/** The form `useProbingForm` returns, for a shared field component to take as a prop. */
export type ProbingForm<TParams extends Record<string, unknown>> = ReturnType<
  typeof useProbingForm<TParams>
>

/** One field's current value, its visible errors and its change and blur handlers. */
export type ProbingFieldState<TValue> = {
  value: TValue
  errors: FieldErrors
  onChange: (value: TValue) => void
  onBlur: () => void
}

/**
 * One field of a probing form, rendered on demand (`probingField`, `probing-fields.tsx`). A
 * shared field component such as `PlacementFields` cannot name a path on a form whose exact
 * shape it does not know (TanStack Form's field types do not narrow through a generic form
 * parameter); this lets its caller, whose form is concretely typed, supply the field instead.
 */
export type ProbingField<TValue> = (
  render: (field: ProbingFieldState<TValue>) => ReactNode
) => ReactNode

/**
 * The draft/revision wrapper every probing settings component needs: a value the form did not
 * emit (another view, undo, another operation) starts a fresh draft, remounting the form (by its
 * `key`) so the form's own state, such as touched fields or a remembered anchor, starts over
 * with it.
 */
export function useProbingDraft<TParams>(
  value: TParams,
  onChange: (value: TParams) => void
): { key: number; onChange: (value: TParams) => void } {
  const [draft, setDraft] = useState({ value, revision: 0 })
  if (!evaluate(draft.value, value))
    setDraft({ value, revision: draft.revision + 1 })
  return {
    key: draft.revision,
    onChange: (next) => {
      setDraft((current) => ({ ...current, value: next }))
      onChange(next)
    },
  }
}
