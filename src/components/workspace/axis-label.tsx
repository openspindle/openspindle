import type { Axis } from "@/machine/contract"

/** Each axis in its colour, as the 3D view draws the work origin's axes. */
export const AXIS_COLORS: Readonly<Record<Axis, string>> = {
  X: "text-red-600 dark:text-red-400",
  Y: "text-emerald-600 dark:text-emerald-400",
  Z: "text-blue-600 dark:text-blue-400",
}

/** An axis letter in its colour. */
export function AxisLabel({ axis }: { axis: Axis }) {
  return <span className={AXIS_COLORS[axis]}>{axis}</span>
}
