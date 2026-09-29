import { useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { REGEXP_ONLY_DIGITS } from "input-otp"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { AppDialog } from "@/features/shell/app-dialog"
import {
  closeDialog,
  currentDialog,
  openDialog,
} from "@/features/shell/dialogs"
import { FusionOtpSchema } from "@/platform/contract/fusion"
import { useFusionConnection } from "@/platform/fusion"
import { useHost } from "@/platform/host-context"
import { useFusionLifetime } from "./use-fusion-lifetime"

const PairingFormSchema = z.object({ code: FusionOtpSchema })

/** The bearer is exchanged in main; this form holds only the short-lived code. */
export function FusionPairingDialog({
  requestId,
  returnToFusion,
}: {
  requestId: string
  returnToFusion: boolean
}) {
  const fusion = useHost().fusion
  const connection = useFusionConnection()
  const lifetime = useFusionLifetime()
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)
  const active = connection.data?.request?.requestId === requestId
  const stillOpen = () => {
    const dialog = currentDialog()
    return dialog?.kind === "fusion-pairing" && dialog.requestId === requestId
  }
  const dismiss = async () => {
    if (canceling) return
    setCanceling(true)
    lifetime.current.abort()
    try {
      await fusion.dismissPairing(requestId)
      if (!stillOpen()) return
      if (returnToFusion) openDialog({ kind: "fusion" })
      else closeDialog()
    } catch (failure) {
      if (!stillOpen()) return
      lifetime.current = new AbortController()
      setError(failure instanceof Error ? failure.message : String(failure))
      setCanceling(false)
    }
  }
  const form = useForm({
    defaultValues: { code: "" },
    validators: { onSubmit: PairingFormSchema },
    onSubmit: async ({ value }) => {
      setError(null)
      const signal = lifetime.current.signal
      try {
        await fusion.pair(requestId, value.code, signal)
        signal.throwIfAborted()
        form.reset()
        if (stillOpen()) openDialog({ kind: "fusion" })
      } catch (failure) {
        if (!signal.aborted)
          setError(failure instanceof Error ? failure.message : String(failure))
      }
    },
  })
  return (
    <AppDialog
      title="Fusion 360 wants to connect"
      description="Enter the six-digit code shown in Fusion 360."
      onClose={() => {
        void dismiss()
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(submitting) => (
            <FieldGroup>
              <form.Field name="code">
                {(field) => (
                  <Field data-invalid={!field.state.meta.isValid || !!error}>
                    <FieldLabel htmlFor={id}>Connection code</FieldLabel>
                    <InputOTP
                      id={id}
                      autoFocus
                      maxLength={6}
                      pattern={REGEXP_ONLY_DIGITS}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={field.state.value}
                      onChange={(value) => {
                        field.handleChange(value)
                        setError(null)
                      }}
                      onBlur={field.handleBlur}
                      disabled={!active || submitting || canceling}
                      aria-invalid={!field.state.meta.isValid || !!error}
                      containerClassName="font-numeric"
                    >
                      <InputOTPGroup>
                        {[0, 1, 2].map((index) => (
                          <InputOTPSlot
                            key={index}
                            index={index}
                            aria-invalid={!field.state.meta.isValid || !!error}
                          />
                        ))}
                      </InputOTPGroup>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        {[3, 4, 5].map((index) => (
                          <InputOTPSlot
                            key={index}
                            index={index}
                            aria-invalid={!field.state.meta.isValid || !!error}
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
              {error && <FieldError role="alert">{error}</FieldError>}
              {!active && !submitting && !error && (
                <FieldError role="alert">
                  This request has expired or ended. Click Connect to
                  OpenSpindle in Fusion for a new code.
                </FieldError>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={canceling}
                  onClick={() => {
                    void dismiss()
                  }}
                >
                  Cancel
                </Button>
                <form.Subscribe selector={(state) => state.values.code}>
                  {(code) => (
                    <Button
                      type="submit"
                      disabled={
                        !active || submitting || canceling || code.length !== 6
                      }
                    >
                      {submitting ? "Connecting…" : "Connect"}
                    </Button>
                  )}
                </form.Subscribe>
              </div>
            </FieldGroup>
          )}
        </form.Subscribe>
      </form>
    </AppDialog>
  )
}
