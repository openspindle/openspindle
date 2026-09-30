import { plus } from "./frame"
import type { Frame, Transform, Vec2, XY, XYZ } from "./frame"
import { EPSILON } from "./millimetres"

/** An axis-aligned rectangle between its lowest and highest corner, in frame `TFrame`. */
export type Rect<TFrame extends Frame = Frame> = {
  readonly min: XY<TFrame>
  readonly max: XY<TFrame>
}

/** An axis-aligned box between its lowest and highest corner, in frame `TFrame`. */
export type Box3<TFrame extends Frame = Frame> = {
  readonly min: XYZ<TFrame>
  readonly max: XYZ<TFrame>
}

/** The rectangle of a size from a corner: its lowest when the size is positive. */
export const rectAt = <TFrame extends Frame>(
  corner: XY<TFrame>,
  size: Vec2
): Rect<TFrame> => {
  const far = plus(corner, size)
  return {
    min: [Math.min(corner[0], far[0]), Math.min(corner[1], far[1])],
    max: [Math.max(corner[0], far[0]), Math.max(corner[1], far[1])],
  }
}

/** A rectangle's extent in X and Y. */
export const rectSize = (rect: Rect): Vec2 => [
  rect.max[0] - rect.min[0],
  rect.max[1] - rect.min[1],
]

/** A rectangle's middle. */
export const rectCenter = <TFrame extends Frame>({
  min,
  max,
}: Rect<TFrame>): XY<TFrame> => [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2]

/** A box's footprint in X and Y. */
export const boxRect = <TFrame extends Frame>({
  min,
  max,
}: Box3<TFrame>): Rect<TFrame> => ({
  min: [min[0], min[1]],
  max: [max[0], max[1]],
})

const isPoint = <TFrame extends Frame>(
  value: Rect<TFrame> | XY<TFrame>
): value is XY<TFrame> => Array.isArray(value)

/** Whether a point or a rectangle lies within a rectangle, its edges included, to `tolerance`. */
export function contains<TFrame extends Frame>(
  outer: Rect<TFrame>,
  inner: Rect<TFrame> | XY<TFrame>,
  tolerance = EPSILON
): boolean {
  const { min, max } = isPoint(inner) ? { min: inner, max: inner } : inner
  return (
    min[0] >= outer.min[0] - tolerance &&
    min[1] >= outer.min[1] - tolerance &&
    max[0] <= outer.max[0] + tolerance &&
    max[1] <= outer.max[1] + tolerance
  )
}

/** A rectangle in another frame: the bounds of its corners there. */
export function mapRect<TFrom extends Frame, TTo extends Frame>(
  rect: Rect<TFrom>,
  transform: Transform<TFrom, TTo>
): Rect<TTo> {
  const low = transform(rect.min)
  const high = transform(rect.max)
  return {
    min: [Math.min(low[0], high[0]), Math.min(low[1], high[1])],
    max: [Math.max(low[0], high[0]), Math.max(low[1], high[1])],
  }
}

/** The smallest rectangle around points; null for none. */
export function boundsOf<TFrame extends Frame>(
  points: Iterable<XY<TFrame>>
): Rect<TFrame> | null {
  let min: [number, number] | null = null
  let max: [number, number] = [-Infinity, -Infinity]
  for (const [x, y] of points) {
    min = min ? [Math.min(min[0], x), Math.min(min[1], y)] : [x, y]
    max = [Math.max(max[0], x), Math.max(max[1], y)]
  }
  return min ? { min, max } : null
}
