import { useId } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { isSimulator } from "@/machine/contract"
import type { MachineSnapshot } from "@/machine/contract"
import { useMachineSnapshot } from "@/platform/machine"
import { useGamepadStepJog } from "./use-gamepad-step-jog"

/** Controller input using the connected machine's supported motion modes. */
export function GamepadStepControls({
  step,
  speed,
  spindleRpm,
  adjustStep,
  cycleSpeed,
  stop,
}: {
  step: number
  speed: number
  spindleRpm: number
  adjustStep: (delta: -1 | 1) => void
  cycleSpeed: () => void
  stop: () => Promise<MachineSnapshot>
}) {
  const id = useId()
  const snapshot = useMachineSnapshot()
  const device = snapshot.connection.device
  const simulator = device !== null && isSimulator(device)
  const input = useGamepadStepJog({
    connectionId: snapshot.connection.id,
    enabled: snapshot.connection.status === "connected",
    directSupported: simulator,
    step,
    speed,
    spindleRpm,
    adjustStep,
    cycleSpeed,
    stop,
  })
  const selected = input.selected
  const canArm =
    selected?.supported === true &&
    snapshot.simulatorController.arm.allowed &&
    !input.pending
  const modeId = `${id}-mode`
  let status = "No controller detected — wake it with a button"
  if (selected)
    status = selected.supported
      ? "Standard Xbox-style mapping"
      : "Mapping unsupported — input monitor only"
  return (
    <FieldSet>
      <FieldLegend
        variant="label"
        className="flex flex-wrap items-center justify-between gap-2"
      >
        Gamepad
        <Badge variant="secondary">
          {simulator ? "Simulator" : "Machine controls"}
        </Badge>
      </FieldLegend>
      {input.controllers.length > 0 && (
        <Field>
          <FieldLabel htmlFor={id}>Controller</FieldLabel>
          <OptionSelect
            id={id}
            className="w-full"
            value={input.selection}
            options={input.controllers.map((entry) => ({
              value: entry.key,
              label: entry.name,
            }))}
            onValueChange={input.select}
          />
        </Field>
      )}
      <FieldDescription>{status}</FieldDescription>
      <Field>
        <FieldLabel htmlFor={modeId}>Control mode</FieldLabel>
        <OptionSelect
          id={modeId}
          className="w-full"
          value={input.mode}
          options={[
            { value: "step", label: "Step" },
            {
              value: "direct",
              label: "Direct",
              disabled: !simulator,
              reason: !simulator
                ? "Stock Z1 firmware has no verified release-to-stop jog cancellation. Use Step."
                : undefined,
            },
          ]}
          onValueChange={input.setMode}
        />
      </Field>
      {selected && (
        <FieldDescription className="font-numeric">
          Stick X {selected.x.toFixed(2)} · Y {selected.y.toFixed(2)} · LB{" "}
          {selected.enableHeld ? "held" : "released"}
        </FieldDescription>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={input.armed ? "secondary" : "outline"}
          disabled={!input.armed && !canArm}
          title={snapshot.simulatorController.arm.reason ?? undefined}
          onClick={() => {
            if (input.armed) input.disarm()
            else void input.arm()
          }}
        >
          {input.armed ? "Disarm controller" : "Arm controller"}
        </Button>
        <Badge variant={input.armed ? "default" : "outline"}>
          {input.armed ? "Armed" : "Disarmed"}
        </Badge>
      </div>
      {input.mode === "step" && (
        <FieldDescription>
          Hold LB, then use the left stick or D-pad for one XY step, or
          right-stick up/down for one Z step. Return to centre before the next
          step. B halts the machine and disarms.
        </FieldDescription>
      )}
      {input.mode === "step" && (
        <FieldDescription>
          A sent step runs to its selected distance on normal release. X/RB or
          disarming interrupts it. Return to centre before another step.
          Continuous steering is not enabled in Step mode.
        </FieldDescription>
      )}
      {input.mode === "direct" && (
        <FieldDescription>
          Hold LB to steer; release the stick or LB to stop. Jog speed is the
          maximum speed. Left stick steers XY; right-stick up/down steers Z. B
          halts and disarms. Disarm to use other machine controls.
        </FieldDescription>
      )}
      <FieldDescription>
        Hold X and wait for motion to stop: D-pad up/down changes target RPM by
        1,000; A starts, Y stops the spindle. Centre both sticks and release LB
        before starting. Disarming stops motion and spindle.
      </FieldDescription>
      {!simulator && (
        <FieldDescription>
          Stock Z1 uses finite Step jogging with the spindle stopped. A step
          finishes on ordinary stick release. Interrupting or disarming during
          motion uses Stop and enters Alarm; unlock and home before rearming.
          Direct steering is available on the simulator only.
        </FieldDescription>
      )}
      <FieldDescription role="status">{input.notice}</FieldDescription>
      <FieldDescription>
        Click the left stick to cycle the Jog speed percentage. Each click
        advances once; holding it does not repeat.
      </FieldDescription>
      <FieldDescription>
        Hold RB and tap D-pad left/right to decrease/increase the step size.
        Release LB first. This shortcut never jogs.
      </FieldDescription>
    </FieldSet>
  )
}
