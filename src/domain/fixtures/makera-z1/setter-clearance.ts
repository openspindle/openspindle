import type { GCodeSegment, Point3 } from "../../nc/gcode"
import { SETTER_RADIUS } from "./tool-setter"

/** Whether a move other than a setter touch or a vertical retract enters the setter's clearance. */
export function entersSetterClearance(
  { start, end, toolSetterTouch, probing, spindle }: GCodeSegment,
  [x, y, top]: Point3,
  toolRadius: number
): boolean {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const dz = end[2] - start[2]
  const xyLengthSquared = dx * dx + dy * dy
  if (xyLengthSquared === 0 && dz > 0) return false
  if (
    toolSetterTouch &&
    probing &&
    spindle === 0 &&
    xyLengthSquared === 0 &&
    Math.hypot(start[0] - x, start[1] - y) <= SETTER_RADIUS
  )
    return false
  if (Math.min(start[2], end[2]) > top) return false

  // Only consider the portion of the move at or below the clearance height.
  const lowStart = start[2] > top ? (top - start[2]) / dz : 0
  const lowEnd = end[2] > top ? (top - start[2]) / dz : 1
  const projection =
    xyLengthSquared === 0
      ? 0
      : ((x - start[0]) * dx + (y - start[1]) * dy) / xyLengthSquared
  const nearest = Math.max(lowStart, Math.min(lowEnd, projection))
  return (
    Math.hypot(start[0] + nearest * dx - x, start[1] + nearest * dy - y) <=
    SETTER_RADIUS + toolRadius
  )
}
