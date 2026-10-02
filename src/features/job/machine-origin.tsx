import { useMemo } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { AxisLabel } from "@/components/workspace/axis-label"
import type { MachineOrigin } from "@/components/workspace/bed-viewer"
import { bedPositionOf } from "@/app/workspace/machine-program"
import type { Point3 } from "@/domain/nc/gcode"
import type { Plate } from "@/domain/plate/plate"
import type { Telemetry } from "@/machine/contract"
import { numberText } from "@/features/device/device-format"

/** Where the connected machine keeps work zero, on the plate's bed; null while unknown. */
export function useMachineOrigin(
  plate: Plate | null,
  telemetry: Telemetry | null
): MachineOrigin | null {
  const origin = telemetry?.workOrigin
  const [x, y, z] = origin ? [origin.x, origin.y, origin.z] : []
  return useMemo(() => {
    if (!plate || x === undefined || y === undefined || z === undefined)
      return null
    const position = bedPositionOf(plate, [x, y, z])
    return position && { plateId: plate.id, position }
  }, [plate, x, y, z])
}

/**
 * Where the machine keeps work zero, from the shown plate's work origin (0 when the machine is
 * set up as the plate plans), its axes in their colours, and the tool offset (T), over the 3D
 * view.
 */
export function MachineOriginCard({
  telemetry,
  origin,
  workOrigin,
}: {
  telemetry: Telemetry | null
  /** The machine's work zero on the plate's bed. */
  origin: MachineOrigin | null
  /** The plate's work origin on its bed. */
  workOrigin: Point3 | null
}) {
  if (!telemetry) return null
  const from = (axis: 0 | 1 | 2) =>
    origin && workOrigin ? origin.position[axis] - workOrigin[axis] : null
  return (
    <Card
      size="sm"
      role="region"
      aria-label="Work origin"
      className="w-28 shadow-lg"
    >
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 [&_dd]:text-right [&_dd]:font-numeric">
          <dt className="font-medium">
            <AxisLabel axis="X" />
          </dt>
          <dd>{numberText(from(0), 3)}</dd>
          <dt className="font-medium">
            <AxisLabel axis="Y" />
          </dt>
          <dd>{numberText(from(1), 3)}</dd>
          <dt className="font-medium">
            <AxisLabel axis="Z" />
          </dt>
          <dd>{numberText(from(2), 3)}</dd>
          <dt className="font-medium text-muted-foreground" title="Tool offset">
            T
          </dt>
          <dd>{numberText(telemetry.toolOffset, 3)}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}
