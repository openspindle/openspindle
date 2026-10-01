import { useEffect, useState } from "react"
import { Crosshair, House, Move3D } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  AvailabilityKey,
  Axis,
  ConnectedDevice,
  MachineCommand,
  Telemetry,
} from "@/machine/contract"
import { Hint } from "@/components/workspace/hint"
import { ReasonButton } from "@/components/workspace/reason-button"
import { axisKey, numberText } from "./device-format"
import { ControlCard } from "./device-control-card"

const AXES = ["X", "Y", "Z"] as const

const ORIGIN_HINT =
  "Where the machine keeps work zero, in machine coordinates: the machine position less the work position, and in Z less the tool offset."

/** Work and machine coordinates and the stored work zero for each axis, zeroing and homing. */
export function DeviceCoordinatesCard({
  device,
  telemetry,
  pending,
  reason,
  allowed,
  execute,
}: {
  device: ConnectedDevice | null
  telemetry: Telemetry | null
  pending: boolean
  reason: (key: AvailabilityKey, action?: MachineCommand) => string | null
  allowed: (action: MachineCommand) => boolean
  execute: (action: MachineCommand) => void
}) {
  const [zeroAxes, setZeroAxes] = useState<Axis[] | null>(null)
  useEffect(() => {
    setZeroAxes(null)
  }, [device?.host, device?.port])
  const requestZero = (axes: Axis[]) => {
    if (!allowed({ type: "zero", axes })) return
    if (axes.includes("Z")) setZeroAxes(axes)
    else execute({ type: "zero", axes })
  }
  return (
    <ControlCard title="Coordinates" icon={<Move3D size={16} />}>
      <Table className="font-numeric [&_tbody_th]:w-10 [&_td]:text-right [&_thead_th:not(:first-child)]:text-right">
        <TableHeader>
          <TableRow>
            <TableHead>Axis</TableHead>
            <TableHead>Work · mm</TableHead>
            <TableHead>Machine · mm</TableHead>
            <TableHead>
              <Hint text={ORIGIN_HINT}>Origin · mm</Hint>
            </TableHead>
            <TableHead>
              <span className="sr-only">Set work zero</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {AXES.map((axis) => (
            <TableRow key={axis}>
              <TableHead scope="row">{axis}</TableHead>
              <TableCell>
                {numberText(telemetry?.work?.[axisKey(axis)], 3)}
              </TableCell>
              <TableCell>
                {numberText(telemetry?.machine?.[axisKey(axis)], 3)}
              </TableCell>
              <TableCell>
                {numberText(telemetry?.workOrigin?.[axisKey(axis)], 3)}
              </TableCell>
              <TableCell>
                <ReasonButton
                  label={`Zero ${axis}`}
                  variant="outline"
                  size="icon"
                  aria-label={`Zero ${axis}`}
                  reason={reason("zero")}
                  disabled={pending}
                  onClick={() => requestZero([axis])}
                >
                  <Crosshair />
                </ReasonButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-2">
        <ReasonButton
          label="Home all"
          variant="ghost"
          size="sm"
          reason={reason("home")}
          disabled={pending}
          onClick={() => execute({ type: "home" })}
        >
          <House />
          Home all
        </ReasonButton>
        <ReasonButton
          label="Zero XYZ"
          variant="ghost"
          size="sm"
          reason={reason("zero")}
          disabled={pending}
          onClick={() => requestZero(["X", "Y", "Z"])}
        >
          <Crosshair />
          Zero XYZ
        </ReasonButton>
      </div>
      {zeroAxes && (
        <FieldSet role="alert">
          <FieldLegend variant="label">Zero work coordinates</FieldLegend>
          <FieldDescription>
            Setting work Z to zero also clears the tool-length offset.
          </FieldDescription>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!allowed({ type: "zero", axes: zeroAxes })}
              onClick={() => {
                execute({ type: "zero", axes: zeroAxes })
                setZeroAxes(null)
              }}
            >
              Zero {zeroAxes.join("")} and clear offset
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZeroAxes(null)}>
              Cancel
            </Button>
          </div>
        </FieldSet>
      )}
    </ControlCard>
  )
}
