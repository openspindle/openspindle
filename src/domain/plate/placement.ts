import type { Stock } from "@/domain/stock/stock"
import type { Point3 } from "../primitives"

/** Where a plate's stock sits (its minimum corner) and its NC zero, in bed millimetres. */
export type PlateCoordinates = { stockAnchor: Point3; workOrigin: Point3 }

/** Whether a stock fits in the machine's work area (its X, Y and Z size). */
export const fitsWorkArea = (
  { width, depth, height }: Pick<Stock, "width" | "depth" | "height">,
  workArea: readonly number[]
) => width <= workArea[0] && depth <= workArea[1] && height <= workArea[2]

/** A machine's work area: its X and Y size, from its front-left corner on the bed (`origin`). */
export type WorkAreaXY = {
  readonly workArea: readonly number[]
  readonly workAreaOrigin: readonly [number, number]
}

/** A coordinate within `[low, high]`. */
const within = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high)

/**
 * Default placement: the stock centred in the machine's work area on its support, the work
 * origin at the stock's top front-left corner; without stock, both at the bed's origin (the
 * machine's first anchor, Anchor 1 on the Z1), or the work area's point nearest it. Physical
 * coordinates, without the viewer's drawing offsets.
 */
export function defaultPlateCoordinates(
  stock: Pick<Stock, "width" | "depth" | "height"> | null,
  { workArea: [width, depth], workAreaOrigin: [x, y] }: WorkAreaXY,
  supportHeight: number
): PlateCoordinates {
  const stockAnchor: Point3 = stock
    ? [
        x + width / 2 - stock.width / 2,
        y + depth / 2 - stock.depth / 2,
        supportHeight,
      ]
    : [within(0, x, x + width), within(0, y, y + depth), supportHeight]
  return {
    stockAnchor,
    workOrigin: [
      stockAnchor[0],
      stockAnchor[1],
      supportHeight + (stock?.height ?? 0),
    ],
  }
}
