import type {
  PointZProbePlan,
  ProbeCheckBinding,
  ZProbeSettings,
} from "@/machine/contract"

const n = (value: number) => String(Number(value.toFixed(4)))

export function zProbeMeasurementNc(tool: number): string {
  if (tool !== 0 && tool !== 9999) throw new Error("Select a supported probe.")
  return [
    "; Fit and connect the selected probe. Tool-setter detection only.",
    "M5",
    "G21 G90 G17 G94",
    "M370",
    `M6 T${tool}`,
    "M400",
    "G53 G0 Z-3",
    "M400",
    "M5",
    "M2",
  ].join("\n")
}

/** No XY positioning or tool change after the operator's checked manual start. */
export function boundedZNc(
  binding: ProbeCheckBinding,
  settings: ZProbeSettings
) {
  return [
    `;@OPENSPINDLE_PROBE_CHECK ${JSON.stringify(binding)}`,
    `;@OPENSPINDLE_Z_PLAN ${JSON.stringify(settings)}`,
    "M5",
    "G21 G90 G17 G94 G54",
    "M370",
    "M494.1",
    "M400",
    ...zContactLines(settings),
  ].join("\n")
}

function zContactLines(settings: ZProbeSettings) {
  return [
    `G38.2 Z-${n(settings.travel)} F30`,
    "G10 L20 P0 Z0",
    "G38.4 Z0.2 F15",
    "G91 G0 Z0.1",
    "M400",
    "G38.2 Z-0.4 F15",
    "G10 L20 P0 Z0",
    "G38.4 Z0.2 F15",
    `G90 G0 Z${n(settings.clearance)}`,
    "M400",
    "M494.2",
    "M5",
    "M2",
  ]
}

/** One retained probe, one signal proof and one owned run; no manual XY or Z positioning. */
export function boundedPointZNc(
  binding: ProbeCheckBinding,
  plan: PointZProbePlan
) {
  const start = [...binding.position]
  const moves: string[] = []
  const move = (axis: number, target: number, feed: number) => {
    const delta = Number(n(target - start[axis]))
    if (Math.abs(delta) >= 0.001)
      moves.push(`G38.3 ${["X", "Y", "Z"][axis]}${delta} F${n(feed)}`, "M400")
    start[axis] = target
  }
  move(2, Math.max(-3, start[2]), plan.feed[2])
  move(0, plan.target[0], plan.feed[0])
  move(1, plan.target[1], plan.feed[1])
  return [
    `;@OPENSPINDLE_PROBE_CHECK ${JSON.stringify(binding)}`,
    `;@OPENSPINDLE_POINT_Z_PLAN ${JSON.stringify(plan)}`,
    "M5",
    "G21 G90 G17 G94 G54",
    "M370",
    "M494.1",
    "M400",
    ...moves,
    ...zContactLines(plan.settings),
  ].join("\n")
}
