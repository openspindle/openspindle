import { useMemo } from "react"
import { Fan, Gauge, RotateCw, Wind } from "lucide-react"
import { machineProgram } from "@/app/workspace/machine-program"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { operationSettings } from "@/domain/compile/operation-settings"
import type {
  OperationSettings,
  ValueRange,
} from "@/domain/compile/operation-settings"
import type { AssistMode } from "@/machine/contract"
import { useFreshTelemetry } from "@/platform/machine"
import { numberText } from "@/features/device/device-format"
import type { JobSubject } from "./job-view"

/** A mode as the plate sets it, or as the machine reports it when the plate keeps the machine's. */
const modeOn = (mode: AssistMode, reported: boolean | null | undefined) =>
  mode === "device" ? (reported ?? null) : mode === "on"

/** What each of the subject's operations sets, by operation id; the machine's modes as reported. */
export function useOperationSettings(subject: JobSubject | null) {
  const telemetry = useFreshTelemetry()
  const assists = subject?.plate.setup.assists
  const vacuum = assists ? modeOn(assists.vacuum, telemetry?.vacuumAuto) : null
  const spindleAir = assists
    ? modeOn(assists.blow, telemetry?.blowingAuto)
    : null
  return useMemo(
    () =>
      subject
        ? operationSettings(
            machineProgram(subject.plate, subject.compiled.program),
            subject.compiled.spans,
            kitForPlate(subject.plate),
            { vacuum, spindleAir }
          )
        : null,
    [subject, vacuum, spindleAir]
  )
}

const rangeText = (range: ValueRange | null, none: string) => {
  if (!range) return none
  const [low, high] = range
  return low === high
    ? numberText(low)
    : `${numberText(low)}–${numberText(high)}`
}

const switchText = (on: boolean | null) => {
  if (on === null) return "—"
  return on ? "On" : "Off"
}

/**
 * What an operation sets the machine to, each by the icon the machine status card shows its
 * reading with: the spindle's speed, the vacuum, the spindle air and the feed. A value names
 * its setting and unit on hover.
 */
export function OperationSettingsRow({
  settings,
}: {
  settings: OperationSettings
}) {
  return (
    <dl
      aria-label="Settings"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 [&_dd]:font-numeric [&_dt]:text-muted-foreground"
    >
      <div className="flex items-center gap-1.5" title="Spindle speed, rpm">
        <dt aria-label="Spindle speed, rpm">
          <RotateCw size={14} />
        </dt>
        <dd>{rangeText(settings.spindle, "Off")}</dd>
      </div>
      <div className="flex items-center gap-1.5" title="Vacuum">
        <dt aria-label="Vacuum">
          <Fan size={14} />
        </dt>
        <dd>{switchText(settings.vacuum)}</dd>
      </div>
      <div className="flex items-center gap-1.5" title="Spindle air">
        <dt aria-label="Spindle air">
          <Wind size={14} />
        </dt>
        <dd>{switchText(settings.spindleAir)}</dd>
      </div>
      <div className="flex items-center gap-1.5" title="Feed rate, mm/min">
        <dt aria-label="Feed rate, mm/min">
          <Gauge size={14} />
        </dt>
        <dd>{rangeText(settings.feed, "—")}</dd>
      </div>
    </dl>
  )
}
