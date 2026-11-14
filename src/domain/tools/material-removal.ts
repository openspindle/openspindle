import { ReferenceModelSchema } from "../models/reference"
import { referenceHeights } from "../models/reference-height"
import { z } from "zod"
import { RemovalCutterSchema } from "./removal-cutter"
import type { RemovalCutter } from "./removal-cutter"
import {
  DEFAULT_REMOVAL_RESOLUTION,
  RemovalResolutionSchema,
} from "./removal-resolution"

const Point = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
])
export const RemovalInputSchema = z.object({
  reference: ReferenceModelSchema.optional(),
  resolution: RemovalResolutionSchema.default(DEFAULT_REMOVAL_RESOLUTION),
  min: Point,
  max: Point,
  segments: z
    .array(
      z.object({
        start: Point,
        end: Point,
        cutter: RemovalCutterSchema.nullable(),
      })
    )
    .max(50000),
})
export type RemovalInput = z.infer<typeof RemovalInputSchema>
export type RemovalGrid = {
  deviation?: Float32Array
  columns: number
  rows: number
  heights: Float32Array
  resolution: number
}
export type RemovalCursor = { move: number; fraction: number }

const MAX_VISITS = 128_000_000

/** Only the part of a V-bit that reaches below stock top needs sampling. */
function engagedRadius(cutter: RemovalCutter, lowest: number, top: number) {
  if (cutter.kind === "flat") return cutter.radius
  return Math.min(
    cutter.radius,
    cutter.tipRadius + Math.max(0, top - lowest) / cutter.slope
  )
}

/** Lowest cone surface over a linear XYZ sweep, including the truncated flat tip. */
function coneHeight(
  cutter: Extract<RemovalCutter, { kind: "v-bit" }>,
  tipZ: number,
  dz: number,
  length2: number,
  projection: number,
  cross2: number,
  first: number,
  last: number
): number {
  const height = (position: number) => {
    const t = Math.max(first, Math.min(last, position))
    const distance = Math.sqrt(cross2 + length2 * (t - projection) ** 2)
    return (
      tipZ + dz * t + cutter.slope * Math.max(0, distance - cutter.tipRadius)
    )
  }
  let cut = Math.min(height(first), height(last))
  const tipReach2 = cutter.tipRadius ** 2 - cross2
  if (tipReach2 >= 0) {
    const reach = Math.sqrt(tipReach2 / length2)
    cut = Math.min(cut, height(projection - reach), height(projection + reach))
  }
  const denominator = length2 * (cutter.slope ** 2 * length2 - dz ** 2)
  if (denominator > 0) {
    // A sloping pass can touch lowest away from the closest XY point.
    const offset = (-dz * Math.sqrt(cross2)) / Math.sqrt(denominator)
    cut = Math.min(cut, height(projection + offset))
  }
  return cut
}

/** Bounded 2.5D sample model. No undercuts, holder contact, fixtures or physical machine state. */
export class MaterialRemoval {
  private readonly input: RemovalInput
  private readonly columns: number
  private readonly rows: number
  private readonly dx: number
  private readonly dy: number
  private readonly heights: Float32Array
  private readonly target: Float32Array | null
  private cursor: RemovalCursor = { move: 0, fraction: 0 }

  constructor(value: unknown) {
    this.input = RemovalInputSchema.parse(value)
    const { min, max, segments } = this.input
    if (max.some((high, axis) => high <= min[axis]))
      throw new Error("Stock dimensions must be positive.")
    const cells = this.input.resolution
    const width = max[0] - min[0]
    const depth = max[1] - min[1]
    const columns = Math.max(
      2,
      Math.ceil((cells * width) / Math.max(width, depth))
    )
    const rows = Math.max(
      2,
      Math.ceil((cells * depth) / Math.max(width, depth))
    )
    const dx = width / columns
    const dy = depth / rows
    let visits = 0
    for (const segment of segments) {
      const lowest = Math.min(segment.start[2], segment.end[2])
      if (segment.cutter === null || lowest >= max[2]) continue
      const radius = engagedRadius(segment.cutter, lowest, max[2])
      const left = Math.max(
        min[0],
        Math.min(segment.start[0], segment.end[0]) - radius
      )
      const right = Math.min(
        max[0],
        Math.max(segment.start[0], segment.end[0]) + radius
      )
      const front = Math.max(
        min[1],
        Math.min(segment.start[1], segment.end[1]) - radius
      )
      const back = Math.min(
        max[1],
        Math.max(segment.start[1], segment.end[1]) + radius
      )
      if (right < left || back < front) continue
      visits +=
        (Math.ceil((right - left) / dx) + 2) *
        (Math.ceil((back - front) / dy) + 2)
    }
    if (visits > MAX_VISITS)
      throw new Error(
        "This program exceeds the removal calculation budget at the selected resolution. Lower Material removal resolution in Settings > General, or preview a smaller plate or operation set."
      )
    this.columns = columns
    this.rows = rows
    this.dx = width / columns
    this.dy = depth / rows
    this.heights = new Float32Array((columns + 1) * (rows + 1))
    this.target = this.input.reference
      ? referenceHeights(
          this.input.reference,
          this.input.min,
          this.input.max,
          columns,
          rows
        )
      : null
    this.reset()
  }

  private reset() {
    this.heights.fill(this.input.max[2] - this.input.min[2])
    this.cursor = { move: 0, fraction: 0 }
  }

  at(request: RemovalCursor): RemovalGrid {
    const count = this.input.segments.length
    const target = {
      move: Math.max(0, Math.min(count, Math.floor(request.move))),
      fraction: Math.max(0, Math.min(1, request.fraction)),
    }
    if (
      target.move < this.cursor.move ||
      (target.move === this.cursor.move &&
        target.fraction < this.cursor.fraction)
    )
      this.reset()
    for (let move = this.cursor.move; move < target.move; move++)
      this.sweep(move, 1)
    if (target.move < count) this.sweep(target.move, target.fraction)
    this.cursor = target
    return {
      columns: this.columns,
      rows: this.rows,
      heights: this.heights.slice(),
      ...(this.target
        ? {
            deviation: this.heights.map(
              (height, i) => height - this.target![i]
            ),
          }
        : {}),
      resolution: Math.max(this.dx, this.dy),
    }
  }

  private sweep(move: number, fraction: number) {
    if (fraction <= 0) return
    const segment = this.input.segments[move]
    const { cutter, start } = segment
    if (cutter === null) return
    const end = start.map(
      (value, axis) => value + (segment.end[axis] - value) * fraction
    )
    const { min, max } = this.input
    if (Math.min(start[2], end[2]) >= max[2]) return
    const radius = engagedRadius(cutter, Math.min(start[2], end[2]), max[2])
    const left = Math.max(
      0,
      Math.ceil((Math.min(start[0], end[0]) - radius - min[0]) / this.dx)
    )
    const right = Math.min(
      this.columns,
      Math.floor((Math.max(start[0], end[0]) + radius - min[0]) / this.dx)
    )
    const front = Math.max(
      0,
      Math.ceil((Math.min(start[1], end[1]) - radius - min[1]) / this.dy)
    )
    const back = Math.min(
      this.rows,
      Math.floor((Math.max(start[1], end[1]) + radius - min[1]) / this.dy)
    )
    const vx = end[0] - start[0]
    const vy = end[1] - start[1]
    const length2 = vx * vx + vy * vy
    for (let row = front; row <= back; row++) {
      const y = min[1] + row * this.dy
      for (let column = left; column <= right; column++) {
        const x = min[0] + column * this.dx
        const projection =
          length2 > 0
            ? ((x - start[0]) * vx + (y - start[1]) * vy) / length2
            : 1
        const t = Math.max(0, Math.min(1, projection))
        const distance2 =
          (x - start[0] - t * vx) ** 2 + (y - start[1] - t * vy) ** 2
        if (distance2 > radius * radius) continue
        // For a ramp, the lowest part of the disk's interval reaches this sample, not just its center.
        let cut = Math.min(start[2], end[2])
        if (length2 > 0) {
          const cross2 = Math.max(
            0,
            (x - start[0]) ** 2 +
              (y - start[1]) ** 2 -
              projection * projection * length2
          )
          const reach = Math.sqrt(
            Math.max(0, radius * radius - cross2) / length2
          )
          const first = Math.max(0, projection - reach)
          const last = Math.min(1, projection + reach)
          cut = Math.min(
            start[2] + first * (end[2] - start[2]),
            start[2] + last * (end[2] - start[2])
          )
          if (cutter.kind === "v-bit")
            cut = coneHeight(
              cutter,
              start[2],
              end[2] - start[2],
              length2,
              projection,
              cross2,
              first,
              last
            )
        } else if (cutter.kind === "v-bit")
          cut +=
            cutter.slope * Math.max(0, Math.sqrt(distance2) - cutter.tipRadius)
        const at = row * (this.columns + 1) + column
        this.heights[at] = Math.min(this.heights[at], Math.max(0, cut - min[2]))
      }
    }
  }
}
