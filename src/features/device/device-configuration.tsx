import { useEffect, useId, useRef, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { ReasonButton } from "@/components/workspace/reason-button"
import { AppDialog } from "@/features/shell/app-dialog"
import { openDialog } from "@/features/shell/dialogs"
import { ConfigurationContentSchema } from "@/machine/contract"
import type { FirmwareConfiguration } from "@/machine/contract"
import {
  useMachineSnapshot,
  useReadConfiguration,
  useWriteConfiguration,
} from "@/platform/machine"

export function DeviceConfigurationCard() {
  const { availability } = useMachineSnapshot()
  const entry = availability.readConfiguration
  const reason = entry.allowed ? null : (entry.reason ?? "Unavailable.")
  return (
    <Card size="sm" role="region" aria-label="Firmware configuration">
      <CardHeader>
        <CardTitle>Firmware configuration</CardTitle>
        <CardAction>
          <ReasonButton
            label="View and edit firmware configuration"
            variant="outline"
            size="sm"
            reason={reason}
            onClick={() => openDialog({ kind: "device-configuration" })}
          >
            View and edit
          </ReasonButton>
        </CardAction>
      </CardHeader>
    </Card>
  )
}

/** Preserve the original newline convention when the textarea reports normalized newlines. */
function configurationText(content: string, original: string): string {
  if (original.includes("\r\n")) return content.replace(/\r?\n/g, "\r\n")
  return content
}

/** A connection-bound copy of the file, written only by the explicit Save action. */
export function DeviceConfigurationDialog({
  onClose,
}: {
  onClose: () => void
}) {
  const id = useId()
  const machine = useMachineSnapshot()
  const read = useReadConfiguration()
  const write = useWriteConfiguration()
  const [configuration, setConfiguration] =
    useState<FirmwareConfiguration | null>(null)
  const [notice, setNotice] = useState("")
  const [confirm, setConfirm] = useState<"close" | "reload" | null>(null)
  const started = useRef(false)
  const pending = read.isPending || write.isPending
  const readAvailability = machine.availability.readConfiguration
  const writeAvailability = machine.availability.writeConfiguration
  const readReason = readAvailability.allowed
    ? null
    : (readAvailability.reason ?? "Unavailable.")
  let writeReason = writeAvailability.allowed
    ? null
    : (writeAvailability.reason ?? "Unavailable.")
  const changedConnection =
    configuration !== null &&
    configuration.connectionId !== machine.connection.id
  if (!writeReason && changedConnection)
    writeReason =
      "The connection changed. Reload the configuration before saving."
  if (!writeReason && !configuration)
    writeReason = "Read the configuration first."

  const form = useForm({
    // TanStack reapplies changed defaults while untouched; keep them in step with reset().
    defaultValues: { content: configuration?.content ?? "" },
    onSubmit: async ({ value }) => {
      if (
        !configuration ||
        writeReason ||
        pending ||
        value.content === configuration.content
      )
        return
      setNotice("")
      read.reset()
      try {
        const result = await write.mutateAsync({
          content: value.content,
          revision: configuration.revision,
          connectionId: configuration.connectionId,
        })
        setConfiguration(result.configuration)
        form.reset({ content: result.configuration.content })
        setNotice(
          result.afterRestart
            ? "Configuration saved. Restart the device to apply it."
            : "Configuration saved."
        )
      } catch {
        // The mutation exposes its error below; keep the edited text for recovery.
      }
    },
  })

  const retrieve = () => {
    if (readReason || pending) return
    setNotice("")
    write.reset()
    read.mutate(undefined, {
      onSuccess: (result) => {
        setConfiguration(result)
        form.reset({ content: result.content })
      },
    })
  }

  useEffect(() => {
    if (started.current || !readAvailability.allowed) return
    started.current = true
    read.mutate(undefined, {
      onSuccess: (result) => {
        setConfiguration(result)
        form.reset({ content: result.content })
      },
    })
  }, [readAvailability.allowed, read.mutate, form])

  const request = (action: "close" | "reload") => {
    if (pending) return
    if (configuration && form.state.values.content !== configuration.content) {
      setConfirm(action)
      return
    }
    if (action === "close") onClose()
    else retrieve()
  }

  const failure = write.error ?? read.error
  return (
    <>
      <AppDialog
        title="Firmware configuration"
        description={machine.connection.device?.name}
        width="wide"
        onClose={() => request("close")}
        footer={
          <>
            <ReasonButton
              label="Reload configuration"
              variant="outline"
              className="sm:mr-auto"
              reason={readReason}
              disabled={pending}
              onClick={() => request("reload")}
            >
              {read.isPending ? "Reading…" : "Reload"}
            </ReasonButton>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => request("close")}
            >
              Close
            </Button>
            <form.Subscribe
              selector={(state) =>
                [state.values.content, state.canSubmit] as const
              }
            >
              {([content, canSubmit]) => (
                <ReasonButton
                  label="Save configuration"
                  type="submit"
                  form={`${id}-form`}
                  reason={writeReason}
                  disabled={
                    pending || !canSubmit || content === configuration?.content
                  }
                >
                  {write.isPending ? "Saving…" : "Save"}
                </ReasonButton>
              )}
            </form.Subscribe>
          </>
        }
      >
        <form
          id={`${id}-form`}
          onSubmit={(event) => {
            event.preventDefault()
            void form.handleSubmit()
          }}
        >
          <FieldGroup>
            {failure && (
              <Alert variant="destructive">
                <AlertDescription>{failure.message}</AlertDescription>
              </Alert>
            )}
            {changedConnection && (
              <Alert>
                <AlertDescription>
                  The connection changed. Your edits are kept here. Reload the
                  configuration before saving to the connected device.
                </AlertDescription>
              </Alert>
            )}
            {!configuration && (
              <FieldDescription role="status">
                {read.isPending ? "Reading configuration…" : readReason}
              </FieldDescription>
            )}
            {configuration && (
              <form.Field
                name="content"
                validators={{ onChange: ConfigurationContentSchema }}
              >
                {(field) => (
                  <Field data-invalid={!field.state.meta.isValid}>
                    <FieldLabel htmlFor={`${id}-content`}>
                      {configuration.path}
                    </FieldLabel>
                    <Textarea
                      id={`${id}-content`}
                      className="h-[48vh] min-h-64 font-mono"
                      value={field.state.value}
                      readOnly={pending || !writeAvailability.allowed}
                      spellCheck={false}
                      autoCapitalize="off"
                      autoCorrect="off"
                      wrap="off"
                      aria-invalid={!field.state.meta.isValid}
                      onBlur={field.handleBlur}
                      onChange={(event) => {
                        setNotice("")
                        field.handleChange(
                          configurationText(
                            event.target.value,
                            configuration.content
                          )
                        )
                      }}
                    />
                    <FieldError errors={field.state.meta.errors} />
                    <FieldDescription role="status">
                      {field.state.value !== configuration.content
                        ? "Unsaved changes"
                        : notice}
                    </FieldDescription>
                  </Field>
                )}
              </form.Field>
            )}
          </FieldGroup>
        </form>
      </AppDialog>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "reload"
                ? "Reloading replaces your edits with the configuration from the connected device."
                : "Your configuration edits have not been saved."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const action = confirm
                setConfirm(null)
                if (action === "close") onClose()
                else if (action === "reload") retrieve()
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
