import { useEffect, useId, useRef, useState } from "react"
import { useForm, useSelector } from "@tanstack/react-form"
import { z } from "zod"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Hint } from "@/components/workspace/hint"
import { MeasurementInput } from "@/components/workspace/measurement-input"
import { ReasonButton } from "@/components/workspace/reason-button"
import { VacuumDefaultPowerSchema } from "@/machine/contract"
import type { FirmwareConfiguration } from "@/machine/contract"
import {
  useCachedConfiguration,
  useMachineSnapshot,
  useReadConfiguration,
  useWriteConfiguration,
} from "@/platform/machine"

const VACUUM_POWER_HINT = "Default vacuum power when open (50 - 100)"

const VacuumPowerFieldsSchema = z.object({
  percent: z
    .string()
    .refine(
      (value) =>
        value.trim() !== "" &&
        VacuumDefaultPowerSchema.safeParse(Number(value)).success,
      "Enter a whole percentage from 50 to 100."
    ),
})

/** Drafts and saved configuration revisions belong to their original connection. */
export function DeviceVacuumPowerField({ pending }: { pending: boolean }) {
  const { connection } = useMachineSnapshot()
  return (
    <VacuumPowerForm
      key={connection.id ?? "disconnected"}
      connectionId={connection.id}
      commandPending={pending}
    />
  )
}

/** Reads once when available; only Save or Enter changes the stored default. */
function VacuumPowerForm({
  connectionId,
  commandPending,
}: {
  connectionId: string | null
  commandPending: boolean
}) {
  const id = useId()
  const { availability } = useMachineSnapshot()
  const read = useReadConfiguration()
  const write = useWriteConfiguration()
  const cached = useCachedConfiguration(connectionId)
  const [configuration, setConfiguration] =
    useState<FirmwareConfiguration | null>(null)
  const [notice, setNotice] = useState("")
  const [needsReload, setNeedsReload] = useState(false)
  const started = useRef(false)
  const mounted = useRef(true)
  const pending = commandPending || read.isPending || write.isPending
  const readReason = availability.readConfiguration.allowed
    ? null
    : (availability.readConfiguration.reason ?? "Unavailable.")
  const writeReason = availability.writeConfiguration.allowed
    ? null
    : (availability.writeConfiguration.reason ?? "Unavailable.")
  const saved = configuration?.vacuumDefaultPower
  const baseline = saved == null ? "" : String(saved)

  const form = useForm({
    defaultValues: { percent: baseline },
    validators: { onChange: VacuumPowerFieldsSchema },
    onSubmit: async ({ value }) => {
      if (
        !configuration ||
        configuration.connectionId !== connectionId ||
        pending ||
        writeReason ||
        needsReload ||
        value.percent === baseline
      )
        return
      setNotice("")
      read.reset()
      try {
        const result = await write.mutateAsync({
          vacuumDefaultPower: Number(value.percent),
          revision: configuration.revision,
          connectionId: configuration.connectionId,
        })
        if (
          !mounted.current ||
          result.configuration.connectionId !== connectionId
        )
          return
        setConfiguration(result.configuration)
        form.reset({ percent: String(result.configuration.vacuumDefaultPower) })
        setNotice("Saved.")
      } catch {
        // Preserve the draft, but obtain a fresh revision before another save.
        if (mounted.current) setNeedsReload(true)
      }
    },
  })
  const currentDraft = useSelector(form.store, (state) => state.values.percent)

  useEffect(() => {
    if (
      !cached ||
      cached.connectionId !== connectionId ||
      pending ||
      needsReload ||
      currentDraft !== baseline ||
      (configuration &&
        (cached.fetchedAt < configuration.fetchedAt ||
          cached.revision === configuration.revision))
    )
      return
    // An edit in the configuration dialog can update a pristine field. Dirty drafts
    // retain their original revision so saving still detects a conflicting change.
    setConfiguration(cached)
    form.reset({
      percent:
        cached.vacuumDefaultPower === null
          ? ""
          : String(cached.vacuumDefaultPower),
    })
    setNotice("")
  }, [
    baseline,
    cached,
    configuration,
    connectionId,
    currentDraft,
    form,
    needsReload,
    pending,
  ])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (started.current || pending || !availability.readConfiguration.allowed)
      return
    started.current = true
    read.mutate(undefined, {
      onSuccess: (result) => {
        if (!mounted.current || result.connectionId !== connectionId) return
        setConfiguration(result)
        form.reset({
          percent:
            result.vacuumDefaultPower === null
              ? ""
              : String(result.vacuumDefaultPower),
        })
      },
      onError: () => {
        if (mounted.current) setNeedsReload(true)
      },
    })
  }, [
    availability.readConfiguration.allowed,
    connectionId,
    form,
    pending,
    read.mutate,
  ])

  const retrieve = () => {
    if (readReason || pending) return
    const draft = form.state.values.percent
    const keepDraft = configuration !== null && draft !== baseline
    setNotice("")
    write.reset()
    read.mutate(undefined, {
      onSuccess: (result) => {
        if (!mounted.current || result.connectionId !== connectionId) return
        setConfiguration(result)
        setNeedsReload(false)
        form.reset({
          percent:
            result.vacuumDefaultPower === null
              ? ""
              : String(result.vacuumDefaultPower),
        })
        if (keepDraft) form.setFieldValue("percent", draft)
      },
      onError: () => {
        if (mounted.current) setNeedsReload(true)
      },
    })
  }

  const failure = write.error ?? read.error
  const inputDisabled = pending || !configuration || writeReason !== null

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldGroup>
        <form.Field name="percent">
          {(field) => (
            <Field
              orientation="horizontal"
              data-invalid={!field.state.meta.isValid}
              data-disabled={inputDisabled}
            >
              <FieldContent className="min-w-0 self-center">
                <FieldLabel htmlFor={id}>
                  <Hint text={VACUUM_POWER_HINT}>Vacuum power</Hint>
                </FieldLabel>
                <FieldError errors={field.state.meta.errors} />
                {(read.isPending || notice) && (
                  <FieldDescription role="status">
                    {read.isPending ? "Reading configuration…" : notice}
                  </FieldDescription>
                )}
              </FieldContent>
              <div className="flex shrink-0 items-center gap-2">
                <div className="w-28">
                  <MeasurementInput
                    id={id}
                    aria-label="Vacuum power"
                    aria-description={VACUUM_POWER_HINT}
                    type="number"
                    unit="%"
                    min={50}
                    max={100}
                    step={1}
                    value={field.state.value}
                    aria-invalid={!field.state.meta.isValid}
                    disabled={inputDisabled}
                    onChange={(event) => {
                      setNotice("")
                      field.handleChange(event.target.value)
                    }}
                    onBlur={field.handleBlur}
                  />
                </div>
                <form.Subscribe selector={(state) => state.canSubmit}>
                  {(canSubmit) => (
                    <ReasonButton
                      label="Save vacuum power"
                      type="submit"
                      variant="outline"
                      reason={writeReason}
                      disabled={
                        pending ||
                        !configuration ||
                        needsReload ||
                        !canSubmit ||
                        field.state.value.trim() === "" ||
                        field.state.value === baseline
                      }
                    >
                      {write.isPending ? "Saving…" : "Save"}
                    </ReasonButton>
                  )}
                </form.Subscribe>
                {needsReload && (
                  <ReasonButton
                    label="Reload vacuum power"
                    type="button"
                    variant="outline"
                    reason={readReason}
                    disabled={pending}
                    onClick={retrieve}
                  >
                    Reload
                  </ReasonButton>
                )}
              </div>
            </Field>
          )}
        </form.Field>
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>{failure.message}</AlertDescription>
          </Alert>
        )}
      </FieldGroup>
    </form>
  )
}
