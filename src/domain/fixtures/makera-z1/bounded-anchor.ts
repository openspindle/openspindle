import type { ProbeCheckBinding } from "@/machine/contract"

const n = (value: number) => String(Number(value.toFixed(4)))

/** The host independently checks this exact sequence before executing its steps. */
export function boundedAnchorNc(
  binding: ProbeCheckBinding,
  gap: number,
  diameter: number,
  maxTravel: readonly [number, number, number]
): string {
  const radius = Number((diameter / 2).toFixed(4))
  const depth = Math.max(2, radius + 0.5)
  return [
    `;@OPENSPINDLE_PROBE_CHECK ${JSON.stringify(binding)}`,
    `;@OPENSPINDLE_ANCHOR_PLAN ${JSON.stringify({ gap, diameter, maxTravel })}`,
    "; Bounded Anchor 1: start at the manually positioned, signal-checked pose with the measured probe still fitted.",
    "; No tool change or automatic descent from clearance. Every contact is verified before continuing.",
    "M5",
    "G21 G90 G17 G94 G54",
    "M370",
    "M494.1",
    "M400",
    `G38.2 Z-${n(maxTravel[2])} F30`,
    "G10 L20 P0 Z0",
    "G38.4 Z0.2 F15",
    "G91 G0 Z0.1",
    "M400",
    "G38.2 Z-0.4 F15",
    "G10 L20 P0 Z0",
    "G38.4 Z0.2 F15",
    "G90 G0 Z5",
    "M400",
    "G91 G0 X10 Y10",
    "M400",
    `G90 G1 Z-${n(depth)} F30`,
    "M400",
    `G38.2 X-${n(maxTravel[0])} F30`,
    "G38.4 X0.2 F15",
    "G91 G0 X2",
    "M400",
    "G38.2 X-2.4 F15",
    `G10 L20 P0 X${n(radius)}`,
    "G38.4 X0.2 F15",
    "G91 G0 X2",
    "G90 G0 X5",
    "M400",
    `G38.2 Y-${n(maxTravel[1])} F30`,
    "G38.4 Y0.2 F15",
    "G91 G0 Y2",
    "M400",
    "G38.2 Y-2.4 F15",
    `G10 L20 P0 Y${n(radius)}`,
    "G38.4 Y0.2 F15",
    "G91 G0 Y2",
    "M400",
    "G90 G0 Z5",
    "M400",
    "M5",
    "M2",
  ].join("\n")
}

/** Explicit setup job for a newly fitted probe; no automatic bracket positioning. */
export function anchorMeasurementNc(): string {
  return [
    "; Fit and connect the selected 3D probe. Tool-setter detection only.",
    "M5",
    "G21 G90 G17 G94",
    "M370",
    "M6 T9999",
    "M400",
    "G53 G0 Z-3",
    "M400",
    "M5",
    "M2",
  ].join("\n")
}
