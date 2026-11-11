import { z } from "zod"

const Point = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
])
export const RemovalInputSchema = z.object({
  min: Point,
  max: Point,
  segments: z
    .array(
      z.object({
        start: Point,
        end: Point,
        radius: z.number().positive().nullable(),
      })
    )
    .max(50000),
})
export type RemovalInput = z.infer<typeof RemovalInputSchema>
export type RemovalGrid = {
  columns: number
  rows: number
  heights: Float32Array
  resolution: number
}
export type RemovalCursor = { move: number; fraction: number }

const MAX_AXIS = 128
const MIN_AXIS = 16
const MAX_VISITS = 8_000_000

/** Bounded 2.5D sample model. No undercuts, holder contact, fixtures or physical machine state. */
export class MaterialRemoval {
  private readonly input: RemovalInput
  private readonly columns: number
  private readonly rows: number
  private readonly dx: number
  private readonly dy: number
  private readonly heights: Float32Array
  private cursor: RemovalCursor = { move: 0, fraction: 0 }

  constructor(value: unknown) {
    this.input = RemovalInputSchema.parse(value)
    const { min, max, segments } = this.input
    if (max.some((high, axis) => high <= min[axis]))
      throw new Error("Stock dimensions must be positive.")
    let cells = MAX_AXIS
    const width = max[0] - min[0]
    const depth = max[1] - min[1]
    let visits = Infinity
    let columns = cells
    let rows = cells
    while (cells >= MIN_AXIS) {
      columns = Math.max(2, Math.ceil((cells * width) / Math.max(width, depth)))
      rows = Math.max(2, Math.ceil((cells * depth) / Math.max(width, depth)))
      const dx = width / columns
      const dy = depth / rows
      visits = 0
      for (const segment of segments) {
        if (
          segment.radius === null ||
          Math.min(segment.start[2], segment.end[2]) >= max[2]
        )
          continue
        const left = Math.max(
          min[0],
          Math.min(segment.start[0], segment.end[0]) - segment.radius
        )
        const right = Math.min(
          max[0],
          Math.max(segment.start[0], segment.end[0]) + segment.radius
        )
        const front = Math.max(
          min[1],
          Math.min(segment.start[1], segment.end[1]) - segment.radius
        )
        const back = Math.min(
          max[1],
          Math.max(segment.start[1], segment.end[1]) + segment.radius
        )
        if (right < left || back < front) continue
        visits +=
          (Math.ceil((right - left) / dx) + 2) *
          (Math.ceil((back - front) / dy) + 2)
      }
      if (visits <= MAX_VISITS) break
      cells /= 2
    }
    if (visits > MAX_VISITS)
      throw new Error(
        "This program exceeds the sampled removal budget. Preview a smaller plate or operation set."
      )
    this.columns = columns
    this.rows = rows
    this.dx = width / columns
    this.dy = depth / rows
    this.heights = new Float32Array((columns + 1) * (rows + 1))
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
      resolution: Math.max(this.dx, this.dy),
    }
  }

  private sweep(move: number, fraction: number) {
    if (fraction <= 0) return
    const segment = this.input.segments[move]
    const { radius, start } = segment
    if (radius === null) return
    const end = start.map(
      (value, axis) => value + (segment.end[axis] - value) * fraction
    )
    const { min, max } = this.input
    if (Math.min(start[2], end[2]) >= max[2]) return
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
        }
        const at = row * (this.columns + 1) + column
        this.heights[at] = Math.min(this.heights[at], Math.max(0, cut - min[2]))
      }
    }
  }
}
