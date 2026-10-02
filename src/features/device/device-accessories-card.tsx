import { useId } from "react"
import { Camera, Fan, Lightbulb, Power, RotateCw, Volume2 } from "lucide-react"
import type { ReactNode } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { useWorkLightControl } from "@/components/work-light-control"
import type {
  AvailabilityKey,
  MachineCommand,
  Telemetry,
} from "@/machine/contract"
import { useMachineSnapshot } from "@/platform/machine"
import { ControlCard } from "./device-control-card"
import { DeviceCameraVideoField } from "./device-camera-video-field"
import { WorkLightBrightnessFields } from "./work-light-brightness-fields"
import { DeviceVacuumPowerField } from "./device-vacuum-power-field"

function OutputControl({
  label,
  description,
  icon,
  value,
  disabled,
  onChange,
}: {
  label: string
  description?: string
  icon?: ReactNode
  value: boolean | null | undefined
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  const id = useId()
  return (
    <Field
      orientation="horizontal"
      data-disabled={disabled}
      className="items-center gap-3"
    >
      {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <Switch
        id={id}
        aria-label={label}
        checked={value === true}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </Field>
  )
}

/**
 * The machine's accessories: the work light, beep, vacuum and following the spindle, and its
 * camera's video size.
 */
export function DeviceAccessoriesCard({
  telemetry,
  pending,
  reason,
  execute,
}: {
  telemetry: Telemetry | null
  pending: boolean
  reason: (key: AvailabilityKey, action?: MachineCommand) => string | null
  execute: (action: MachineCommand) => void
}) {
  const light = useWorkLightControl()
  const { features } = useMachineSnapshot()
  const busy = pending || light.pending
  const lightAction = telemetry?.lightOn === true ? "light" : "lightBrightness"
  return (
    <ControlCard title="Accessories" icon={<Power size={16} />}>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        <OutputControl
          label="Beep"
          icon={<Volume2 size={19} />}
          value={telemetry?.beepOn}
          disabled={busy || reason("beep") !== null}
          onChange={(enabled) => execute({ type: "beep", enabled })}
        />
        <OutputControl
          label="Follow spindle"
          icon={<RotateCw size={19} />}
          value={telemetry?.vacuumAuto}
          disabled={busy || reason("vacuumAuto") !== null}
          onChange={(enabled) => execute({ type: "vacuumAuto", enabled })}
        />
      </FieldGroup>
      <FieldSet>
        <FieldLegend className="flex items-center gap-2">
          <Lightbulb size={16} />
          Work light
        </FieldLegend>
        <FieldGroup>
          <OutputControl
            label="Light"
            value={telemetry?.lightOn}
            disabled={busy || reason(lightAction) !== null}
            onChange={(enabled) => {
              if (enabled) light.turnOn()
              else execute({ type: "light", enabled: false })
            }}
          />
          <WorkLightBrightnessFields />
        </FieldGroup>
        {light.error && (
          <Alert variant="destructive">
            <AlertDescription>{light.error.message}</AlertDescription>
          </Alert>
        )}
      </FieldSet>
      <FieldSet>
        <FieldLegend className="flex items-center gap-2">
          <Fan size={16} />
          Vacuum
        </FieldLegend>
        <FieldGroup>
          <OutputControl
            label="Vacuum"
            description="External extractor"
            value={telemetry?.vacuumOn}
            disabled={busy || reason("vacuum") !== null}
            onChange={(enabled) => execute({ type: "vacuum", enabled })}
          />
          <DeviceVacuumPowerField pending={busy} />
        </FieldGroup>
      </FieldSet>
      {features?.camera === true && features.configuration && (
        <FieldSet>
          <FieldLegend className="flex items-center gap-2">
            <Camera size={16} />
            Camera
          </FieldLegend>
          <FieldGroup>
            <DeviceCameraVideoField pending={busy} />
          </FieldGroup>
        </FieldSet>
      )}
    </ControlCard>
  )
}
