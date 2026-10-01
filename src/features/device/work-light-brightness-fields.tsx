import { useEffect, useId } from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import {
  WorkLightIdleMinutesSchema,
  WorkLightPercentSchema,
  useWorkLightPreferences,
} from "@/components/work-light-preferences"
import { MeasurementInput } from "@/components/workspace/measurement-input"
import { Hint } from "@/components/workspace/hint"

const DAYLIGHT_HINT =
  "Used with OpenSpindle’s light appearance. With System selected, it follows your system’s appearance."
const NIGHT_HINT =
  "Used with OpenSpindle’s dark appearance. With System selected, it follows your system’s appearance."
const INACTIVITY_TIMER_HINT =
  "Turns the light off after this many minutes of machine inactivity while OpenSpindle is connected. 0 means never."

const BrightnessFieldSchema = z.object({
  percent: z
    .string()
    .refine(
      (value) => WorkLightPercentSchema.safeParse(Number(value)).success,
      "Enter a whole percentage from 1 to 100."
    ),
})

const InactivityTimerSchema = z.object({
  minutes: z
    .string()
    .refine(
      (value) =>
        value.trim() !== "" &&
        WorkLightIdleMinutesSchema.safeParse(Number(value)).success,
      "Enter whole minutes from 0 to 1440."
    ),
})

/** Draft typing stays local; only a completed field updates the saved preference. */
function BrightnessField({
  label,
  hint,
  value,
  onCommit,
}: {
  label: string
  hint: string
  value: number
  onCommit: (percent: number) => void
}) {
  const id = useId()
  const form = useForm({
    defaultValues: { percent: String(value) },
    validators: { onChange: BrightnessFieldSchema },
    onSubmit: ({ value: submitted }) => onCommit(Number(submitted.percent)),
  })
  useEffect(() => {
    form.reset({ percent: String(value) })
  }, [form, value])
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="percent">
        {(field) => (
          <Field
            orientation="horizontal"
            data-invalid={!field.state.meta.isValid}
          >
            <FieldContent className="min-w-0 self-center">
              <FieldLabel htmlFor={id}>
                <Hint text={hint}>{label}</Hint>
              </FieldLabel>
              <FieldError errors={field.state.meta.errors} />
            </FieldContent>
            <div className="w-28 shrink-0">
              <MeasurementInput
                id={id}
                aria-label={`Work light ${label.toLowerCase()}`}
                aria-description={hint}
                type="number"
                unit="%"
                min={1}
                max={100}
                step={1}
                value={field.state.value}
                aria-invalid={!field.state.meta.isValid}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={() => {
                  field.handleBlur()
                  void form.handleSubmit()
                }}
              />
            </div>
          </Field>
        )}
      </form.Field>
    </form>
  )
}

function InactivityTimerField({
  value,
  onCommit,
}: {
  value: number
  onCommit: (minutes: number) => void
}) {
  const id = useId()
  const form = useForm({
    defaultValues: { minutes: String(value) },
    validators: { onChange: InactivityTimerSchema },
    onSubmit: ({ value: submitted }) => onCommit(Number(submitted.minutes)),
  })
  useEffect(() => {
    form.reset({ minutes: String(value) })
  }, [form, value])
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Field name="minutes">
        {(field) => (
          <Field
            orientation="horizontal"
            data-invalid={!field.state.meta.isValid}
          >
            <FieldContent className="min-w-0 self-center">
              <FieldLabel htmlFor={id}>
                <Hint text={INACTIVITY_TIMER_HINT}>Inactivity timer</Hint>
              </FieldLabel>
              <FieldError errors={field.state.meta.errors} />
            </FieldContent>
            <div className="w-28 shrink-0">
              <MeasurementInput
                id={id}
                aria-label="Work light inactivity timer"
                aria-description={INACTIVITY_TIMER_HINT}
                type="number"
                unit="min"
                min={0}
                max={1440}
                step={1}
                value={field.state.value}
                aria-invalid={!field.state.meta.isValid}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={() => {
                  field.handleBlur()
                  void form.handleSubmit()
                }}
              />
            </div>
          </Field>
        )}
      </form.Field>
    </form>
  )
}

export function WorkLightBrightnessFields() {
  const { brightness, setBrightness, idleMinutes, setIdleMinutes, saveError } =
    useWorkLightPreferences()
  return (
    <>
      <BrightnessField
        label="Daylight brightness"
        hint={DAYLIGHT_HINT}
        value={brightness.light}
        onCommit={(percent) => setBrightness("light", percent)}
      />
      <BrightnessField
        label="Night brightness"
        hint={NIGHT_HINT}
        value={brightness.dark}
        onCommit={(percent) => setBrightness("dark", percent)}
      />
      <InactivityTimerField value={idleMinutes} onCommit={setIdleMinutes} />
      {saveError && <FieldError>{saveError}</FieldError>}
    </>
  )
}
