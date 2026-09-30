import { parseGCode } from "@/domain/nc/gcode"
import type { GCodeSegment } from "@/domain/nc/gcode"
import type { PlateSetup } from "../plate/plate"
import type { XY } from "../geometry/frame"
import type { Rect } from "../geometry/rect"
import type { Point3 } from "../primitives"
import { isProbeSlot } from "../tools/tool-table"

/** Where a design cuts: the extent of its cutting moves, in work coordinates (from the work origin). */
export type ToolpathBounds = { readonly min: Point3; readonly max: Point3 }

export type ToolpathBoundsResult =
  | { readonly ok: true; readonly bounds: ToolpathBounds }
  | { readonly ok: false; readonly reason: string }

/** A position on the bed, X and Y in millimetres. */
export type BedXY = XY<"bed">
/** Where probing works: the toolpath bounds on the bed, within the stock. */
export type WorkArea = Rect<"bed">
export type WorkAreaResult =
  | {
      readonly ok: true
      readonly area: WorkArea
      /** What the area is: where the plate cuts, or the stock of a plate that machines nothing. */
      readonly covers: "cuts" | "stock"
    }
  | { readonly ok: false; readonly reason: string }

/**
 * Feed moves cut, except the probes' (T0, and the 3D probe's slot) and probing, such as a tool's
 * touches on a tool setter: rapids and probe moves travel.
 */
export const cuts = (
  segment: Pick<GCodeSegment, "rapid" | "tool" | "probing">
) => !segment.rapid && !isProbeSlot(segment.tool) && !segment.probing

function unite(a: ToolpathBounds, b: ToolpathBounds): ToolpathBounds {
  const axes = [0, 1, 2] as const
  return {
    min: axes.map((axis) => Math.min(a.min[axis], b.min[axis])) as Point3,
    max: axes.map((axis) => Math.max(a.max[axis], b.max[axis])) as Point3,
  }
}

const measured = new Map<string, ToolpathBounds | null>()
const MEASURED_PROGRAMS = 32

/**
 * The extent of a program's cutting moves, in its own coordinates; null without any. The point
 * a program starts from is the preview's assumption, not a position it moves to, so the first
 * move's start does not count. Cached per NC text, so operations keep theirs across edits.
 */
export function cuttingBounds(nc: string): ToolpathBounds | null {
  if (measured.has(nc)) {
    const bounds = measured.get(nc) ?? null
    // Most recently used last, so the oldest program is dropped first.
    measured.delete(nc)
    measured.set(nc, bounds)
    return bounds
  }
  const { segments } = parseGCode(nc)
  let bounds: ToolpathBounds | null = null
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!cuts(segment)) continue
    const ends = index ? [segment.start, segment.end] : [segment.end]
    for (const point of ends) {
      const own: ToolpathBounds = { min: [...point], max: [...point] }
      bounds = bounds ? unite(bounds, own) : own
    }
  }
  measured.set(nc, bounds)
  if (measured.size > MEASURED_PROGRAMS)
    measured.delete(measured.keys().next().value as string)
  return bounds
}

/**
 * Where a plate's machining operations cut together: the cutting bounds of their programs, each
 * measured from its own NC (null for an operation without NC).
 */
export function toolpathBoundsOf(
  programs: readonly (string | null)[]
): ToolpathBoundsResult {
  if (!programs.length)
    return { ok: false, reason: "The plate has no machining operations." }
  let bounds: ToolpathBounds | null = null
  for (const nc of programs) {
    const own = nc === null ? null : cuttingBounds(nc)
    if (own) bounds = bounds ? unite(bounds, own) : own
  }
  if (!bounds)
    return {
      ok: false,
      reason: "The plate's machining operations have no cutting moves.",
    }
  return { ok: true, bounds }
}

// Hundredths outwards; the nudge keeps 12.35 from reading as 12.349999….
const down = (value: number) =>
  Number((Math.floor(value * 100 + 1e-6) / 100).toFixed(2))
const up = (value: number) =>
  Number((Math.ceil(value * 100 - 1e-6) / 100).toFixed(2))

/** Bounds rounded outwards to hundredths of a millimetre, for NC words and messages. */
export const roundOutward = ({ min, max }: ToolpathBounds): ToolpathBounds => ({
  min: [down(min[0]), down(min[1]), down(min[2])],
  max: [up(max[0]), up(max[1]), up(max[2])],
})

/**
 * Toolpath bounds on the bed (placed at the work origin) within the stock as placed, rounded
 * outwards to hundredths without leaving the stock: where the probing operations fit their grid
 * and touch point.
 */
export function workAreaOnStock(
  { min, max }: ToolpathBounds,
  setup: Pick<PlateSetup, "stock" | "stockAnchor" | "workOrigin">
): WorkAreaResult {
  const [originX, originY] = setup.workOrigin
  let low: BedXY = [down(min[0] + originX), down(min[1] + originY)]
  let high: BedXY = [up(max[0] + originX), up(max[1] + originY)]
  const { stock, stockAnchor } = setup
  if (stock) {
    const [stockX, stockY] = stockAnchor
    low = [Math.max(low[0], stockX), Math.max(low[1], stockY)]
    high = [
      Math.min(high[0], stockX + stock.width),
      Math.min(high[1], stockY + stock.depth),
    ]
    if (low[0] > high[0] || low[1] > high[1])
      return {
        ok: false,
        reason: "The cutting moves are off the stock as placed.",
      }
  }
  return { ok: true, area: { min: low, max: high }, covers: "cuts" }
}

/** The whole stock as placed, rounded outwards: the work area of a plate that machines nothing. */
export function stockWorkArea(
  setup: Pick<PlateSetup, "stock" | "stockAnchor">
): WorkAreaResult {
  const { stock, stockAnchor } = setup
  if (!stock)
    return {
      ok: false,
      reason: "The plate has no machining operations and no stock.",
    }
  const [x, y] = stockAnchor
  return {
    ok: true,
    area: {
      min: [down(x), down(y)],
      max: [up(x + stock.width), up(y + stock.depth)],
    },
    covers: "stock",
  }
}
