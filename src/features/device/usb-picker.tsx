import { useId } from "react"
import { useForm } from "@tanstack/react-form"
import { useQuery } from "@tanstack/react-query"
import { z } from "zod"
import { useFixtureLibrary } from "@/app/fixtures/fixture-context"
import { kitForDeviceId } from "@/domain/fixtures/catalog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldDescription,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { isLocalIPv4 } from "@/machine/contract"
import type { ConnectedDevice, ConnectTarget } from "@/machine/contract"
import { useMachineHost } from "@/platform/machine"

const OptionsSchema = z.object({
  cameraHost: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || isLocalIPv4(value),
      "Enter a local IPv4 address or leave empty."
    ),
  profileId: z.string(),
  portId: z.string().min(1),
})

/** A scan never opens a port; Connect uses the selected FTDI identity, never a typed path. */
export function UsbPicker({
  busy,
  device,
  pendingId,
  connectTo,
}: {
  busy: boolean
  device: ConnectedDevice | null
  pendingId: string | null
  connectTo: (target: ConnectTarget) => void
}) {
  const machine = useMachineHost()
  const id = useId()
  const profiles = useFixtureLibrary((library) => library.profiles)
  const choices = Object.entries(profiles).filter(
    ([key]) => kitForDeviceId(key) !== null && key.length <= 128
  )
  const ports = useQuery({
    queryKey: ["machine", "serialDevices"],
    queryFn: () => machine.serialDevices(),
    enabled: false,
    retry: false,
  })
  const form = useForm({
    defaultValues: { cameraHost: "", profileId: "new", portId: "" },
    validators: { onSubmit: OptionsSchema },
    onSubmit: ({ value }) => {
      const selected = ports.data?.find((port) => port.id === value.portId)
      if (!selected) return
      const profile = choices.find(([key]) => key === value.profileId)
      connectTo({
        transport: "serial",
        portId: selected.id,
        pathHint: selected.path,
        ...(value.cameraHost.trim()
          ? { cameraHost: value.cameraHost.trim() }
          : {}),
        ...(profile
          ? {
              profile: {
                id: profile[0],
                model: profile[0].slice(0, profile[0].indexOf(":")),
                name: profile[1].name,
              },
            }
          : {}),
      })
    },
  })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <FieldSet>
        <FieldLegend
          variant="label"
          className="flex w-full items-center justify-between gap-3"
        >
          <span>USB serial</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || ports.isFetching}
            onClick={() => void ports.refetch()}
          >
            {ports.isFetching ? "Scanning…" : "Scan USB"}
          </Button>
        </FieldLegend>
        {ports.data && (
          <FieldGroup>
            <form.Field name="profileId">
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={`${id}-profile`}>
                    Machine profile
                  </FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value) =>
                      field.handleChange(value ?? "new")
                    }
                    disabled={busy}
                  >
                    <SelectTrigger id={`${id}-profile`} className="w-full">
                      <SelectValue>
                        {(value) =>
                          value === "new"
                            ? "New USB profile"
                            : (choices.find(([key]) => key === value)?.[1]
                                .name ?? value)
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="new">New USB profile</SelectItem>
                        {choices.map(([key, profile]) => (
                          <SelectItem key={key} value={key}>
                            {profile.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </form.Field>
            <form.Field name="cameraHost">
              {(field) => (
                <Field data-invalid={!field.state.meta.isValid}>
                  <FieldLabel htmlFor={`${id}-camera`}>
                    Camera IP address (optional)
                  </FieldLabel>
                  <Input
                    id={`${id}-camera`}
                    value={field.state.value}
                    disabled={busy}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                    aria-invalid={!field.state.meta.isValid}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            {!ports.data.length && (
              <FieldDescription>No FTDI serial devices found.</FieldDescription>
            )}
            {ports.data.map((port) => {
              const connected =
                device?.transport === "serial" && device.portId === port.id
              let label = "Connect"
              if (connected) label = "Connected"
              if (pendingId === port.id) label = "Connecting…"
              return (
                <Field key={port.id}>
                  <FieldLabel>
                    {port.manufacturer} · {port.path}
                  </FieldLabel>
                  {!port.stable && (
                    <FieldDescription>
                      No unique hardware serial number; select this port again
                      after reconnecting.
                    </FieldDescription>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || connected}
                    onClick={() => {
                      form.setFieldValue("portId", port.id)
                      void form.handleSubmit()
                    }}
                  >
                    {label}
                  </Button>
                </Field>
              )
            })}
          </FieldGroup>
        )}
        {ports.error && <FieldError>{ports.error.message}</FieldError>}
      </FieldSet>
    </form>
  )
}
