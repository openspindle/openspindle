import { endpointLabel } from "@/machine/contract"
import { useEffect, useId, useState } from "react"
import { Gauge } from "lucide-react"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import type {
  AvailabilityKey,
  ConnectedDevice,
  ControlLimits,
  MachineCommand,
  Telemetry,
} from "@/machine/contract"
import { MeasurementInput } from "@/components/workspace/measurement-input"
import { ReasonButton } from "@/components/workspace/reason-button"
import { numberText } from "./device-format"
import { ControlCard } from "./device-control-card"

/** The feed and spindle overrides: their reported percent, and a field to apply a new one. */
export function DeviceOverridesCard({
  device,
  telemetry,
  limits,
  pending,
  reason,
  execute,
}: {
  device: ConnectedDevice | null
  telemetry: Telemetry | null
  limits: ControlLimits | null
  pending: boolean
  reason: (key: AvailabilityKey, action?: MachineCommand) => string | null
  execute: (action: MachineCommand) => void
}) {
  const fieldId = useId()
  const [feedPercent, setFeedPercent] = useState("")
  const [spindlePercent, setSpindlePercent] = useState("")
  useEffect(() => {
    setFeedPercent("")
    setSpindlePercent("")
  }, [device ? endpointLabel(device) : null])
  return (
    <ControlCard title="Overrides" icon={<Gauge size={16} />}>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {(
          [
            {
              type: "feedOverride",
              label: "Feed",
              reported: telemetry?.feedOverride,
              value: feedPercent,
              setValue: setFeedPercent,
            },
            {
              type: "spindleOverride",
              label: "Spindle",
              reported: telemetry?.spindleOverride,
              value: spindlePercent,
              setValue: setSpindlePercent,
            },
          ] as const
        ).map((setting) => {
          const percent =
            setting.value === ""
              ? (setting.reported ?? 100)
              : Number(setting.value)
          const action: MachineCommand = { type: setting.type, percent }
          return (
            <form
              key={setting.type}
              onSubmit={(event) => {
                event.preventDefault()
                execute(action)
              }}
            >
              <Field>
                <FieldLabel
                  htmlFor={`${fieldId}-${setting.type}`}
                  className="justify-between"
                >
                  {setting.label}{" "}
                  <span className="font-numeric text-muted-foreground">
                    {setting.reported != null
                      ? `${numberText(setting.reported)}%`
                      : null}
                  </span>
                </FieldLabel>
                <div className="flex items-center gap-2">
                  <MeasurementInput
                    id={`${fieldId}-${setting.type}`}
                    unit="%"
                    type="number"
                    aria-label={`${setting.label} override`}
                    min={limits?.overrideMin}
                    max={limits?.overrideMax}
                    step={1}
                    value={setting.value}
                    placeholder={String(percent)}
                    disabled={!device}
                    onChange={(event) => setting.setValue(event.target.value)}
                  />
                  <ReasonButton
                    label={`Apply ${setting.label.toLowerCase()} override`}
                    type="submit"
                    variant="outline"
                    reason={reason(setting.type, action)}
                    disabled={pending}
                  >
                    Apply
                  </ReasonButton>
                </div>
              </Field>
            </form>
          )
        })}
      </FieldGroup>
      <dl className="grid gap-4 sm:grid-cols-2 [&_dd]:font-numeric">
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Spindle</dt>
          <dd>{numberText(telemetry?.spindleTemperature)} °C</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">Controller</dt>
          <dd>{numberText(telemetry?.controllerTemperature)} °C</dd>
        </div>
      </dl>
    </ControlCard>
  )
}
