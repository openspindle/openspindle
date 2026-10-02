import { Fan, Gauge, RotateCw, Thermometer, Wind } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { Telemetry } from "@/machine/contract"
import { numberText } from "@/features/device/device-format"

/** An output's power while it is on, Off while it is off, a dash while unknown. */
function outputText(on: boolean | null, power: number | null) {
  if (on === null) return "—"
  if (!on) return "Off"
  return power === null ? "On" : numberText(power)
}

/**
 * The spindle's temperature and speed, the vacuum, the spindle air and the feed rate the machine
 * reports, each by its icon, over the 3D view above the work origin; a row names its reading and
 * unit on hover.
 */
export function MachineStatusCard({
  telemetry,
}: {
  telemetry: Telemetry | null
}) {
  if (!telemetry) return null
  return (
    <Card
      size="sm"
      role="region"
      aria-label="Machine status"
      className="w-28 shadow-lg"
    >
      <CardContent>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 [&_dd]:text-right [&_dd]:font-numeric [&_dt]:text-muted-foreground">
          <div className="contents" title="Spindle temperature, °C">
            <dt aria-label="Spindle temperature, °C">
              <Thermometer size={14} />
            </dt>
            <dd>{numberText(telemetry.spindleTemperature, 1)}</dd>
          </div>
          <div className="contents" title="Spindle speed, rpm">
            <dt aria-label="Spindle speed, rpm">
              <RotateCw size={14} />
            </dt>
            <dd>{numberText(telemetry.spindleRpm)}</dd>
          </div>
          <div className="contents" title="Vacuum power, %">
            <dt aria-label="Vacuum power, %">
              <Fan size={14} />
            </dt>
            <dd>{outputText(telemetry.vacuumOn, telemetry.vacuumPower)}</dd>
          </div>
          <div className="contents" title="Spindle air power, %">
            <dt aria-label="Spindle air power, %">
              <Wind size={14} />
            </dt>
            <dd>
              {outputText(telemetry.spindleAirOn, telemetry.spindleAirPower)}
            </dd>
          </div>
          <div className="contents" title="Feed rate, mm/min">
            <dt aria-label="Feed rate, mm/min">
              <Gauge size={14} />
            </dt>
            <dd>{numberText(telemetry.feed)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
