import { Pause, Play } from "lucide-react"
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type {
  AvailabilityKey,
  ConnectedDevice,
  MachineCommand,
  MachineFeatures,
  Telemetry,
} from "@/machine/contract"
import {
  useCompiledPlate,
  useSelectedPlate,
} from "@/app/workspace/workspace-context"
import { DeviceCamera } from "@/components/workspace/device-camera"
import { SimulatedCamera } from "@/features/viewer/simulated-camera"
import { Hint } from "@/components/workspace/hint"
import { ReasonButton } from "@/components/workspace/reason-button"
import { numberText, toolText } from "./device-format"

const TOOL_OFFSET_HINT =
  "The tool's length offset from the tool work Z was set with: where it met the tool setter, less where that tool did."

/** The camera, live telemetry and the running program's progress, with pause and resume. */
export function DeviceStatusCard({
  device,
  features,
  telemetry,
  pending,
  reason,
  execute,
}: {
  device: ConnectedDevice | null
  features: MachineFeatures | null
  telemetry: Telemetry | null
  pending: boolean
  reason: (key: AvailabilityKey, action?: MachineCommand) => string | null
  execute: (action: MachineCommand) => void
}) {
  const plate = useSelectedPlate()
  const compiled = useCompiledPlate(plate)
  const shown = plate && compiled ? { plate, compiled } : null
  return (
    <>
      <DeviceCamera
        device={device}
        available={features?.camera === true}
        simulated={<SimulatedCamera shown={shown} />}
      />
      <Card size="sm" role="region" aria-label="Live machine status">
        <CardContent>
          <dl className="grid grid-cols-4 gap-4 [&_dd]:font-numeric">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Feed rate</dt>
              <dd>
                {numberText(telemetry?.feed)}{" "}
                <span className="text-muted-foreground">mm/min</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Spindle</dt>
              <dd>
                {numberText(telemetry?.spindleRpm)}{" "}
                <span className="text-muted-foreground">rpm</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Tool</dt>
              <dd>{toolText(telemetry?.tool)}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">
                <Hint text={TOOL_OFFSET_HINT}>Tool offset</Hint>
              </dt>
              <dd>
                {numberText(telemetry?.toolOffset, 3)}{" "}
                <span className="text-muted-foreground">mm</span>
              </dd>
            </div>
          </dl>
        </CardContent>
        <CardFooter className="gap-2">
          <ReasonButton
            label="Pause"
            variant="outline"
            size="sm"
            reason={reason("pause")}
            disabled={pending}
            onClick={() => execute({ type: "pause" })}
          >
            <Pause />
            Pause
          </ReasonButton>
          {telemetry?.state === "Tool" && !features?.atc && (
            <ReasonButton
              label="Tool installed"
              variant="outline"
              size="sm"
              reason={reason("confirmToolChange")}
              disabled={pending}
              onClick={() => execute({ type: "confirmToolChange" })}
            >
              <Play />
              Tool installed
            </ReasonButton>
          )}
          {telemetry?.state !== "Tool" && (
            <ReasonButton
              label="Resume"
              variant="outline"
              size="sm"
              reason={reason("resume")}
              disabled={pending}
              onClick={() => execute({ type: "resume" })}
            >
              <Play />
              Resume
            </ReasonButton>
          )}
        </CardFooter>
      </Card>
      {telemetry?.job && (
        <Card size="sm" role="region" aria-label="Current device job">
          <CardHeader>
            <CardTitle>Current program</CardTitle>
            <CardAction className="font-numeric">
              {numberText(telemetry.job.percent)}%
            </CardAction>
          </CardHeader>
          <CardContent>
            <Progress
              value={telemetry.job.percent}
              max={100}
              aria-label="Program progress"
            />
          </CardContent>
          <CardFooter className="justify-between gap-2 font-numeric">
            <span>Line {numberText(telemetry.job.line)}</span>
            <span>
              {`${Math.floor(telemetry.job.elapsedSeconds / 60)}:${String(Math.floor(telemetry.job.elapsedSeconds % 60)).padStart(2, "0")}`}
            </span>
          </CardFooter>
        </Card>
      )}
    </>
  )
}
