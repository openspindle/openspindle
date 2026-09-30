import { useId } from "react"
import type { ReactNode } from "react"
import {
  createFormHook,
  createFormHookContexts,
  revalidateLogic,
} from "@tanstack/react-form"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Hint } from "@/components/workspace/hint"
import { MeasurementInput } from "@/components/workspace/measurement-input"
import { toMicrometre } from "@/domain/primitives"
import { ToolDraftSchema } from "@/domain/tools/tool"
import type { Tool, ToolDraft } from "@/domain/tools/tool"
import { OptionSelect } from "@/components/option-select"
import { describeToolError } from "./tool-format"

const { fieldContext, formContext, useFieldContext } = createFormHookContexts()

/** Field errors are ToolDraftSchema issues; show them in editor wording. */
function fieldErrors(errors: readonly unknown[]) {
  return errors.map((error) => {
    const message =
      typeof error === "object" && error !== null && "message" in error
        ? error.message
        : error
    return typeof message === "string"
      ? { message: describeToolError(message) }
      : undefined
  })
}

/** Label, explained by `hint`, control and validation message of the field in context. */
function FieldFrame({
  label,
  hint,
  controlId,
  wide = false,
  children,
}: {
  label: string
  hint?: string
  controlId: string
  wide?: boolean
  children: ReactNode
}) {
  const field = useFieldContext<unknown>()
  return (
    <Field
      className={wide ? "col-span-full" : undefined}
      data-invalid={!field.state.meta.isValid}
    >
      <FieldLabel htmlFor={controlId}>
        <Hint text={hint}>{label}</Hint>
      </FieldLabel>
      {children}
      <FieldError errors={fieldErrors(field.state.meta.errors)} />
    </Field>
  )
}

interface TextFieldProps {
  label: string
  /** Required text is never stored as null; optional text is null when blank. */
  required?: boolean
  suggestions?: readonly string[]
  wide?: boolean
  maxLength?: number
}

function TextField({
  label,
  required = false,
  suggestions,
  wide,
  maxLength = 200,
}: TextFieldProps) {
  const field = useFieldContext<string | null>()
  const id = useId()
  const listId = suggestions ? `${id}-options` : undefined
  return (
    <FieldFrame label={label} controlId={id} wide={wide}>
      <Input
        id={id}
        name={field.name}
        value={field.state.value ?? ""}
        maxLength={maxLength}
        required={required}
        list={listId}
        aria-invalid={!field.state.meta.isValid}
        onBlur={field.handleBlur}
        onChange={(event) =>
          field.handleChange(
            required ? event.target.value : event.target.value || null
          )
        }
      />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
    </FieldFrame>
  )
}

function TextAreaField({
  label,
  maxLength = 4000,
}: {
  label: string
  maxLength?: number
}) {
  const field = useFieldContext<string | null>()
  const id = useId()
  return (
    <FieldFrame label={label} controlId={id} wide>
      <Textarea
        id={id}
        name={field.name}
        rows={3}
        value={field.state.value ?? ""}
        maxLength={maxLength}
        aria-invalid={!field.state.meta.isValid}
        onBlur={field.handleBlur}
        onChange={(event) => field.handleChange(event.target.value || null)}
      />
    </FieldFrame>
  )
}

interface NumberFieldProps {
  label: string
  unit?: string
  integer?: boolean
  max?: number
}

/** Millimetres and degrees commit to three decimals, as MeasurementInput shows them. */
const roundsToThree = (unit: string | undefined) =>
  unit === "mm" || unit === "°"

/** A non-negative number, blank for unknown; millimetres and degrees round to three decimals. */
function NumberField({ label, unit, integer = false, max }: NumberFieldProps) {
  const field = useFieldContext<number | null>()
  const id = useId()
  return (
    <FieldFrame label={label} controlId={id}>
      <MeasurementInput
        id={id}
        name={field.name}
        type="number"
        min="0"
        max={max}
        step={integer ? "1" : "any"}
        value={field.state.value ?? ""}
        placeholder="—"
        unit={unit}
        aria-invalid={!field.state.meta.isValid}
        onBlur={field.handleBlur}
        onChange={(event) => {
          if (event.target.value === "") {
            field.handleChange(null)
            return
          }
          const value = Number(event.target.value)
          field.handleChange(roundsToThree(unit) ? toMicrometre(value) : value)
        }}
      />
    </FieldFrame>
  )
}

export interface Choice<T extends string | boolean> {
  value: T
  label: string
}
const UNSPECIFIED = { value: "", label: "Unspecified" }

/** One of a few values, or unspecified (null) unless the choice is required. */
function ChoiceField<T extends string | boolean>({
  label,
  hint,
  choices,
  required = false,
}: {
  label: string
  hint?: string
  choices: readonly Choice<T>[]
  /** A required choice is never null, so it offers no Unspecified. */
  required?: boolean
}) {
  const field = useFieldContext<T | null>()
  const id = useId()
  const options = [
    ...(required ? [] : [UNSPECIFIED]),
    ...choices.map((choice) => ({
      value: String(choice.value),
      label: choice.label,
    })),
  ]
  return (
    <FieldFrame label={label} hint={hint} controlId={id}>
      <OptionSelect
        id={id}
        className="w-full"
        options={options}
        value={field.state.value === null ? "" : String(field.state.value)}
        aria-description={hint}
        aria-invalid={!field.state.meta.isValid}
        onBlur={field.handleBlur}
        onValueChange={(next) =>
          field.handleChange(
            choices.find((choice) => String(choice.value) === next)?.value ??
              null
          )
        }
      />
    </FieldFrame>
  )
}

const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField, TextAreaField, NumberField, ChoiceField },
  formComponents: {},
})

/** Submit meta: what to do with the saved library once a save succeeds. */
export interface ToolSaveRequest {
  afterSave: ((library: readonly Tool[]) => void) | null
}
const SAVE_ONLY: ToolSaveRequest = { afterSave: null }
// Validate when saving, and on every change once a save was attempted.
const VALIDATION_LOGIC = revalidateLogic()

/**
 * The tool editor's form over a ToolDraft, validated by ToolDraftSchema.
 * `form.handleSubmit(request)` saves through `onSave` only when the draft is valid.
 */
export function useToolForm(
  defaultValues: ToolDraft,
  onSave: (draft: ToolDraft, request: ToolSaveRequest) => void
) {
  return useAppForm({
    defaultValues,
    onSubmitMeta: SAVE_ONLY,
    validationLogic: VALIDATION_LOGIC,
    validators: { onDynamic: ToolDraftSchema },
    onSubmit: ({ value, meta }) => onSave(value, meta),
  })
}
export type ToolForm = ReturnType<typeof useToolForm>
