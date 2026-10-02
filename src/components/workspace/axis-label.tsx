import type { Axis } from "@/machine/contract"

/** Each axis in its colour, as the 3D view draws the work origin's axes. */
export const AXIS_COLORS: Readonly<Record<Axis, string>> = {
  X: "text-red-600 dark:text-red-400",
  Y: "text-emerald-600 dark:text-emerald-400",
  Z: "text-blue-600 dark:text-blue-400",
}

/** An axis letter in its colour, set bold. */
export function AxisLabel({ axis }: { axis: Axis }) {
  return <span className={`font-semibold ${AXIS_COLORS[axis]}`}>{axis}</span>
}

/**
 * An axis and its value, kept on one line: its letter as `AxisLabel` sets it, the value in the
 * numeric face, after a space, or `joined` to it as in Z0.
 */
export function AxisValue({
  axis,
  value,
  joined = false,
}: {
  axis: Axis
  value: string
  joined?: boolean
}) {
  return (
    <span className="whitespace-nowrap">
      <AxisLabel axis={axis} />
      {!joined && " "}
      <span className="font-numeric">{value}</span>
    </span>
  )
}
