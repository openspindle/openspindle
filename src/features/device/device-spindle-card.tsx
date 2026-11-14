import { useId } from "react"
import { Gauge, Play, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Field, FieldLabel } from "@/components/ui/field"
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

/** The target speed field, start/apply and stop, and the actual and requested speeds. */
export function DeviceSpindleCard({
  device,
  rpmInput,
  setRpmInput,
  suggestedRpm,
  telemetry,
  limits,
  pending,
  reason,
  execute,
}: {
  device: ConnectedDevice | null
  rpmInput: string
  setRpmInput: (value: string) => void
  suggestedRpm: number | undefined
  telemetry: Telemetry | null
  limits: ControlLimits | null
  pending: boolean
  reason: (key: AvailabilityKey, action?: MachineCommand) => string | null
  execute: (action: MachineCommand) => void
}) {
  const fieldId = useId()
  const rpm = rpmInput === "" ? (suggestedRpm ?? 0) : Number(rpmInput)
  const startSpindle: MachineCommand = { type: "spindleStart", rpm }
  let spindleState = "—"
  if (telemetry?.spindleOn != null)
    spindleState = telemetry.spindleOn ? "Running" : "Off"
  return (
    <ControlCard
      title="Spindle"
      icon={<Gauge size={16} />}
      action={<Badge variant="secondary">{spindleState}</Badge>}
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          execute(startSpindle)
        }}
      >
        <Field className="min-w-0 flex-1">
          <FieldLabel htmlFor={`${fieldId}-rpm`}>Target speed</FieldLabel>
          <MeasurementInput
            id={`${fieldId}-rpm`}
            unit="rpm"
            aria-label="Target spindle speed"
            type="number"
            min={limits?.spindleRpmMin}
            max={limits?.spindleRpmMax}
            step={100}
            value={rpmInput}
            placeholder={
              suggestedRpm === undefined ? undefined : numberText(suggestedRpm)
            }
            disabled={!device || reason("spindleStart") !== null}
            onChange={(event) => setRpmInput(event.target.value)}
          />
        </Field>
        <ReasonButton
          label={telemetry?.spindleOn ? "Apply spindle speed" : "Start spindle"}
          type="submit"
          reason={reason("spindleStart", startSpindle)}
          disabled={pending}
        >
          <Play />
          {telemetry?.spindleOn ? "Apply" : "Start"}
        </ReasonButton>
        <ReasonButton
          label="Stop spindle"
          type="button"
          variant="outline"
          size="icon"
          aria-label="Stop spindle"
          reason={reason("spindleStop")}
          disabled={pending}
          onClick={() => execute({ type: "spindleStop" })}
        >
          <Square />
        </ReasonButton>
      </form>
      <dl className="flex flex-wrap justify-between gap-4 [&_dd]:font-numeric">
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">Actual</dt>
          <dd>{numberText(telemetry?.spindleRpm)} rpm</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="text-muted-foreground">Requested</dt>
          <dd>{numberText(telemetry?.spindleTargetRpm)} rpm</dd>
        </div>
      </dl>
    </ControlCard>
  )
}
