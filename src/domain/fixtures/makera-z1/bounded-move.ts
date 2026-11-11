import type { ProbeCheckBinding, ProbeMovePlan } from "@/machine/contract"

const n = (value: number) => Number(value.toFixed(4))

/** Probe-aware transit expects no contact: firmware stops on contact, host refuses the next move. */
export function boundedMoveNc(
  binding: ProbeCheckBinding,
  plan: ProbeMovePlan
): string {
  const axes = plan.mode === "xy" ? [2, 0, 1] : [2]
  const moves = axes.flatMap((axis) => {
    const delta = n(plan.target[axis] - binding.position[axis])
    if (Math.abs(delta) < 0.001) return []
    return [
      `G38.3 ${["X", "Y", "Z"][axis]}${delta} F${n(plan.feed[axis])}`,
      "M400",
    ]
  })
  return [
    `;@OPENSPINDLE_PROBE_CHECK ${JSON.stringify(binding)}`,
    `;@OPENSPINDLE_MOVE_PLAN ${JSON.stringify(plan)}`,
    "M5",
    "G21 G90 G17 G94",
    "M370",
    "M400",
    ...moves,
    "M5",
    "M2",
  ].join("\n")
}
