import { FastForward } from "lucide-react"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { Hint } from "@/components/workspace/hint"
import type { ConnectedDevice } from "@/machine/contract"
import { SIMULATOR_SPEEDS } from "@/platform/contract/simulator"
import {
  isAppSimulator,
  useSimulatorStatus,
  useUpdateSimulator,
} from "@/platform/simulator"
import { ControlCard } from "./device-control-card"

const SPEED_OPTIONS = SIMULATOR_SPEEDS.map((speed) => ({
  value: speed,
  label: `${speed}×`,
}))

const SPEED_HINT =
  "How many times faster than a Z1 the simulator moves. A change applies from its next move."

/** The app's simulator, while it is the connected device: how fast it moves. */
export function DeviceSimulatorCard({
  device,
}: {
  device: ConnectedDevice | null
}) {
  const status = useSimulatorStatus().data
  const update = useUpdateSimulator()
  if (!status || !isAppSimulator(device, status)) return null
  return (
    <ControlCard title="Simulator" icon={<FastForward size={16} />}>
      <Field orientation="horizontal">
        <FieldLabel htmlFor="simulator-speed">
          <Hint text={SPEED_HINT}>Speed</Hint>
        </FieldLabel>
        <OptionSelect
          id="simulator-speed"
          aria-description={SPEED_HINT}
          className="w-28"
          numeric
          options={SPEED_OPTIONS}
          value={status.settings.speed}
          onValueChange={(speed) => update.mutate({ speed })}
        />
      </Field>
      {update.error && (
        <FieldError>
          The speed could not be changed: {update.error.message}
        </FieldError>
      )}
    </ControlCard>
  )
}
