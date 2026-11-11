import { z } from "zod"
import type { Tool } from "../tools/tool"
import { toolKindKey } from "../tools/tool"
import type { FacingKeepOut, FixtureKit } from "../fixtures/fixture-kit"
import type { PlateSetup } from "../plate/plate"
import {
  sameAnchorFrame,
  StoredAnchorSetupSchema,
} from "../anchors/stored-anchors"
import { EntityIdSchema, Point3Schema } from "../primitives"

export const FacingParamsSchema = z
  .object({
    x: z.number().finite().min(-10000).max(10000),
    y: z.number().finite().min(-10000).max(10000),
    width: z.number().min(0.001).max(2000),
    depth: z.number().min(0.001).max(2000),
    top: z.number().finite().min(-10000).max(10000),
    removal: z.number().min(0.001).max(100),
    stepdown: z.number().min(0.001).max(100),
    stepover: z.number().min(0.001).max(500),
    pattern: z.enum(["horizontal", "vertical", "cross-hatch"]).optional(),
    borderFirst: z.boolean().optional(),
    diameter: z.number().min(0.001).max(500),
    clearance: z.number().min(0.001).max(500),
    rpm: z.number().int().positive().max(100000),
    feed: z.number().positive().max(100000),
    plunge: z.number().positive().max(100000),
    // Absent in existing projects: preserves their outside-X entry.
    entryMode: z.enum(["outside", "pocket"]).optional(),
    entryX: z.number().finite().min(-10000).max(10000).optional(),
    entryY: z.number().finite().min(-10000).max(10000).optional(),
    entryDiameter: z.number().positive().max(2000).optional(),
    entryDepth: z.number().positive().max(100).optional(),
    entryConfirmed: z.boolean().optional(),
    entryFrame: z
      .object({
        deviceId: EntityIdSchema.nullable(),
        workOrigin: Point3Schema,
        anchors: StoredAnchorSetupSchema.nullable(),
      })
      .optional(),
  })
  .superRefine((p, ctx) => {
    if (p.borderFirst && p.entryMode !== "pocket")
      ctx.addIssue({
        code: "custom",
        path: ["borderFirst"],
        message:
          "A connected border pass requires a verified cleared-pocket entry.",
      })
    if (p.entryMode === "pocket") {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message })
      if (p.entryX === undefined || p.entryY === undefined)
        issue("entryX", "Enter the cleared pocket centre in work coordinates.")
      else if (
        p.entryX < p.x ||
        p.entryX > p.x + p.width ||
        p.entryY < p.y ||
        p.entryY > p.y + p.depth
      )
        issue("entryX", "The entry must be inside the cutter-centre rectangle.")
      if (p.entryDiameter === undefined || p.entryDiameter < p.diameter + 2)
        issue(
          "entryDiameter",
          "The clear opening must be at least the cutter diameter plus 2 mm."
        )
      if (p.entryDepth === undefined || p.entryDepth < p.removal + 0.1)
        issue(
          "entryDepth",
          "Clear depth must exceed total removal by at least 0.1 mm."
        )
      if (p.entryConfirmed !== true)
        issue(
          "entryConfirmed",
          "Verify the pocket position and clearance on the installed bed."
        )
      if (!p.entryFrame)
        issue(
          "entryConfirmed",
          "Verify the entry in the current device and work coordinate frame."
        )
    }
    if (p.stepover > p.diameter / 2)
      ctx.addIssue({
        code: "custom",
        path: ["stepover"],
        message: "Use at most half the cutter diameter for the facing raster.",
      })
    const horizontalRows = Math.ceil(p.depth / p.stepover) + 1
    const verticalRows = Math.ceil(p.width / p.stepover) + 1
    let rowCount = horizontalRows
    if (p.pattern === "vertical") rowCount = verticalRows
    if (p.pattern === "cross-hatch") rowCount += verticalRows
    if (Math.ceil(p.removal / p.stepdown) * rowCount > 20000)
      ctx.addIssue({
        code: "custom",
        path: ["stepover"],
        message:
          "This raster exceeds 20,000 cutting passes. Increase stepover or stepdown.",
      })
  })
export type FacingParams = z.infer<typeof FacingParamsSchema>

export function facingEntryFrameIssue(
  p: FacingParams,
  setup: PlateSetup
): string | null {
  if (p.entryMode !== "pocket") return null
  const frame = p.entryFrame
  if (!frame)
    return "Check the entry pocket in the current setup and confirm its clearance."
  if (
    frame.deviceId !== setup.deviceId ||
    !frame.workOrigin.every((v, axis) => v === setup.workOrigin[axis]) ||
    !sameAnchorFrame(frame.anchors, setup.anchors)
  )
    return "The entry's device, anchors or work origin changed. Reopen Facing and verify the pocket in the current setup."
  return null
}

/** Only cutters whose flat cutting surface is explicitly known, never the generic shape fallback. */
export function facingToolIssue(tool: Tool | undefined): string | null {
  if (!tool) return "Assign a library cutter to the facing tool number."
  if (!["flat end mill", "face mill"].includes(toolKindKey(tool.kind)))
    return "Choose a flat end mill or face mill."
  if (!(tool.diameter !== null && tool.diameter > 0))
    return "Enter the cutter diameter in the library."
  if (!(tool.geometry.fluteLength !== null && tool.geometry.fluteLength > 0))
    return "Enter the cutting length in the library."
  if (
    (tool.geometry.cornerRadius ?? 0) !== 0 ||
    (tool.geometry.taperAngle ?? 0) !== 0 ||
    (tool.geometry.tipDiameter !== null &&
      tool.geometry.tipDiameter !== tool.diameter) ||
    (tool.geometry.maxDiameter !== null &&
      tool.geometry.maxDiameter !== tool.diameter)
  )
    return "This wizard supports straight, flat-ended cutters."
  return null
}

/** Built-in protected footprints translated from the bed to the plate's work coordinates. */
export function facingKeepOuts(
  setup: PlateSetup,
  kit: FixtureKit
): readonly FacingKeepOut[] {
  const [x, y, originZ] = setup.workOrigin
  return kit.facingKeepOuts.map((area) => ({
    ...area,
    min: [area.min[0] - x, area.min[1] - y],
    max: [area.max[0] - x, area.max[1] - y],
    top: area.top - originZ,
  }))
}

/** Cutter-centre spans, clipped against equipment regardless of fixture visibility. */
export function facingRaster(
  p: FacingParams,
  keepOuts: readonly FacingKeepOut[]
) {
  const extension = p.entryMode === "pocket" ? 0 : p.diameter / 2 + 1
  const left = p.x - extension
  const right = p.x + p.width + extension
  const count = Math.ceil(p.depth / p.stepover)
  const expanded = keepOuts.map((area) => {
    // Extra 0.001 mm keeps four-decimal NC rounding outside the clearance boundary.
    const padding = p.diameter / 2 + area.margin + 0.001
    return {
      min: [area.min[0] - padding, area.min[1] - padding] as const,
      max: [area.max[0] + padding, area.max[1] + padding] as const,
    }
  })
  let clipped = false
  const rows = Array.from({ length: count + 1 }, (_, index) => {
    const y = p.y + (p.depth * index) / count
    const blocked = expanded.filter(
      (area) =>
        y >= area.min[1] &&
        y <= area.max[1] &&
        area.max[0] >= left &&
        area.min[0] <= right
    )
    if (!blocked.length) return { y, spans: [[left, right] as const] }
    clipped = true
    // One conservative blocked band also avoids plunging into an island between obstacles.
    const from = Math.min(...blocked.map((area) => area.min[0]))
    const to = Math.max(...blocked.map((area) => area.max[0]))
    const spans: (readonly [number, number])[] = []
    if (from > left) spans.push([left, Math.min(from, right)])
    if (to < right) spans.push([right, Math.max(to, left)])
    return { y, spans }
  })
  const safe = Math.max(
    p.top + p.clearance,
    ...keepOuts.map((area) => area.top + Math.max(p.clearance, area.margin))
  )
  return { left, right, rows, clipped, safe, expanded }
}

type XY = readonly [number, number]
type Rectangle = { min: XY; max: XY }

/** True only if some part of the segment enters the open, padded protected rectangle. */
function crosses(a: XY, b: XY, area: Rectangle): boolean {
  let from = 0
  let to = 1
  for (const axis of [0, 1] as const) {
    const delta = b[axis] - a[axis]
    if (delta === 0) {
      if (a[axis] <= area.min[axis] || a[axis] >= area.max[axis]) return false
      continue
    }
    const first = (area.min[axis] - a[axis]) / delta
    const second = (area.max[axis] - a[axis]) / delta
    from = Math.max(from, Math.min(first, second))
    to = Math.min(to, Math.max(first, second))
    if (from >= to) return false
  }
  return from < to
}

/** Bounded cutting links around padded footprints, all at cutting feed rather than rapid. */
function pocketRoute(
  start: XY,
  end: XY,
  bounds: Rectangle,
  areas: readonly Rectangle[]
): XY[] | null {
  const within = (p: XY) =>
    p.every((v, axis) => v >= bounds.min[axis] && v <= bounds.max[axis])
  if (!within(start) || !within(end)) return null
  const corners = areas
    .flatMap(({ min, max }) => [
      min,
      [min[0], max[1]] as const,
      max,
      [max[0], min[1]] as const,
    ])
    .filter(within)
  const points = [start, end, ...corners]
  const distance = points.map(() => Infinity)
  const previous = points.map(() => -1)
  const visited = new Set<number>()
  distance[0] = 0
  while (visited.size < points.length) {
    let next = -1
    for (let i = 0; i < points.length; i++)
      if (!visited.has(i) && (next === -1 || distance[i] < distance[next]))
        next = i
    if (next === -1 || !Number.isFinite(distance[next])) return null
    if (next === 1) {
      const route: XY[] = []
      for (let i = 1; i !== -1; i = previous[i]) route.unshift(points[i])
      return route
    }
    visited.add(next)
    for (let i = 0; i < points.length; i++) {
      if (
        visited.has(i) ||
        areas.some((area) => crosses(points[next], points[i], area))
      )
        continue
      const length =
        distance[next] +
        Math.hypot(
          points[i][0] - points[next][0],
          points[i][1] - points[next][1]
        )
      if (length < distance[i]) {
        distance[i] = length
        previous[i] = next
      }
    }
  }
  return null
}

/** One connected raster per layer, entered only through the verified empty pocket. */
function horizontalPocketPaths(
  p: FacingParams,
  keepOuts: readonly FacingKeepOut[]
): { issue: string | null; paths: XY[][] } {
  if (p.entryMode !== "pocket") return { issue: null, paths: [] }
  const invalid = FacingParamsSchema.safeParse(p)
  if (!invalid.success)
    return { issue: invalid.error.issues[0].message, paths: [] }
  const raster = facingRaster(p, keepOuts)
  const entry: XY = [p.entryX!, p.entryY!]
  if (
    raster.expanded.some((area) =>
      entry.every((v, axis) => v >= area.min[axis] && v <= area.max[axis])
    )
  )
    return {
      issue:
        "The entry pocket is inside a protected area. Choose another pocket.",
      paths: [],
    }
  const bounds = {
    min: [raster.left, p.y] as const,
    max: [raster.right, p.y + p.depth] as const,
  }
  const path: XY[] = [entry]
  let current = entry
  for (const [index, row] of raster.rows.entries()) {
    // Clipped spans may be stored in either direction. Alternate the complete
    // row so adjacent unobstructed rows share a short, cutting-feed Y link.
    const spans = row.spans.map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
    if (index % 2 !== 0) spans.reverse()
    for (const [left, right] of spans) {
      let start = left
      let end = right
      if (index % 2 !== 0) {
        start = right
        end = left
      }
      const route = pocketRoute(
        current,
        [start, row.y],
        bounds,
        raster.expanded
      )
      if (!route)
        return {
          issue:
            "A facing span cannot be reached from this pocket without crossing a protected area. Change the rectangle or entry.",
          paths: [],
        }
      path.push(...route.slice(1), [end, row.y])
      current = [end, row.y]
    }
  }
  if (path.length === 1) return { issue: null, paths: [] }
  return { issue: null, paths: [path] }
}

/** Transposing the geometry reuses the same clipping and routing for Y-direction cuts. */
const transposePoint = ([x, y]: XY): XY => [y, x]
function transposeParams(p: FacingParams): FacingParams {
  return {
    ...p,
    x: p.y,
    y: p.x,
    width: p.depth,
    depth: p.width,
    entryX: p.entryY,
    entryY: p.entryX,
    pattern: "horizontal",
    borderFirst: false,
  }
}
const transposeAreas = (areas: readonly FacingKeepOut[]) =>
  areas.map((area) => ({
    ...area,
    min: transposePoint(area.min),
    max: transposePoint(area.max),
  }))

/** Conservative centre-travel bounds include outside entry in BOTH cross-hatch directions. */
export function facingCentreBounds(p: FacingParams): Rectangle {
  const extension = p.entryMode === "pocket" ? 0 : p.diameter / 2 + 1
  const x = p.pattern === "vertical" ? 0 : extension
  const y =
    p.pattern === "vertical" || p.pattern === "cross-hatch" ? extension : 0
  return {
    min: [p.x - x, p.y - y],
    max: [p.x + p.width + x, p.y + p.depth + y],
  }
}

/** Free spans on a rectangle edge, respecting the open, padded protected footprints. */
function borderSpans(p: FacingParams, areas: readonly Rectangle[]): XY[][] {
  const result: XY[][] = []
  const edges: [0 | 1, number, number, number][] = [
    [0, p.y, p.x, p.x + p.width],
    [1, p.x + p.width, p.y, p.y + p.depth],
    [0, p.y + p.depth, p.x + p.width, p.x],
    [1, p.x, p.y + p.depth, p.y],
  ]
  for (const [axis, fixed, start, end] of edges) {
    const other = axis === 0 ? 1 : 0
    let spans: number[][] = [[Math.min(start, end), Math.max(start, end)]]
    for (const area of areas) {
      if (fixed <= area.min[other] || fixed >= area.max[other]) continue
      spans = spans.flatMap(([a, b]) => {
        const left = Math.max(a, area.min[axis]),
          right = Math.min(b, area.max[axis])
        if (left >= right) return [[a, b]]
        return [
          ...(a < left ? [[a, left]] : []),
          ...(right < b ? [[right, b]] : []),
        ]
      })
    }
    if (end < start) spans = spans.reverse().map(([a, b]) => [b, a])
    for (const span of spans)
      result.push(
        span.map((value): XY => (axis === 0 ? [value, fixed] : [fixed, value]))
      )
  }
  return result
}

/** Border first, then the chosen raster(s), connected at one depth without another plunge. */
export function facingPocketPaths(
  p: FacingParams,
  keepOuts: readonly FacingKeepOut[]
): { issue: string | null; paths: XY[][] } {
  if (p.entryMode !== "pocket") return { issue: null, paths: [] }
  const parsed = FacingParamsSchema.safeParse(p)
  if (!parsed.success)
    return { issue: parsed.error.issues[0].message, paths: [] }
  const entry: XY = [p.entryX!, p.entryY!]
  const raster = facingRaster(p, keepOuts)
  const bounds: Rectangle = {
    min: [p.x, p.y],
    max: [p.x + p.width, p.y + p.depth],
  }
  const segments: XY[][] = p.borderFirst ? borderSpans(p, raster.expanded) : []
  const addRaster = (vertical: boolean) => {
    const generated = horizontalPocketPaths(
      vertical
        ? transposeParams(p)
        : { ...p, pattern: "horizontal", borderFirst: false },
      vertical ? transposeAreas(keepOuts) : keepOuts
    )
    if (generated.issue) return generated.issue
    for (const path of generated.paths)
      segments.push(vertical ? path.map(transposePoint) : path)
    return null
  }
  if (p.pattern !== "vertical") {
    const issue = addRaster(false)
    if (issue) return { issue, paths: [] }
  }
  if (p.pattern === "vertical" || p.pattern === "cross-hatch") {
    const issue = addRaster(true)
    if (issue) return { issue, paths: [] }
  }
  const path: XY[] = [entry]
  for (const segment of segments) {
    const route = pocketRoute(path.at(-1)!, segment[0], bounds, raster.expanded)
    if (!route)
      return {
        issue:
          "The border or raster cannot be reached without crossing a protected area.",
        paths: [],
      }
    path.push(...route.slice(1), ...segment.slice(1))
  }
  return { issue: null, paths: path.length > 1 ? [path] : [] }
}

/** One outside-entry horizontal raster at a specified layer's depth. */
function outsideLayer(
  p: FacingParams,
  keepOuts: readonly FacingKeepOut[],
  cutZ: number
): string[] {
  const n = (v: number) => v.toFixed(4)
  const raster = facingRaster(p, keepOuts)
  const { left, right, safe } = raster
  const rows = Math.ceil(p.depth / p.stepover)
  const lines: string[] = []
  if (raster.clipped) {
    for (const row of raster.rows)
      for (const [start, end] of row.spans)
        lines.push(
          `G0 Z${n(safe)}`,
          `G0 X${n(start)} Y${n(row.y)}`,
          `G1 Z${n(cutZ)} F${n(p.plunge)}`,
          `G1 X${n(end)} F${n(p.feed)}`,
          `G0 Z${n(safe)}`
        )
    return lines
  }
  lines.push(
    `G0 Z${n(safe)}`,
    `G0 X${n(left)} Y${n(p.y)}`,
    `G1 Z${n(cutZ)} F${n(p.plunge)}`
  )
  for (let row = 0; row <= rows; row++) {
    const y = p.y + (p.depth * row) / rows
    if (row > 0) lines.push(`G1 Y${n(y)} F${n(p.feed)}`)
    lines.push(`G1 X${n(row % 2 === 0 ? right : left)} F${n(p.feed)}`)
  }
  lines.push(`G0 Z${n(safe)}`)
  return lines
}

/** Work-coordinate facing; cross-hatch repeats each layer in X and Y at the SAME Z. */
export function facingNc(
  params: FacingParams,
  tool: number,
  keepOuts: readonly FacingKeepOut[]
): string {
  const p = FacingParamsSchema.parse(params)
  const n = (v: number) => v.toFixed(4)
  const raster = facingRaster(p, keepOuts)
  const pocket = facingPocketPaths(p, keepOuts)
  if (pocket.issue) throw new Error(pocket.issue)
  const safe = raster.safe
  const layers = Math.ceil(p.removal / p.stepdown)
  const lines = [
    "(OpenSpindle facing - review setup before Run)",
    "G21 G90 G17 G94",
    `T${tool} M6`,
    `S${p.rpm} M3`,
    `G0 Z${n(safe)}`,
  ]
  if (p.entryMode === "pocket")
    lines.push(
      `(Operator-verified clear entry: X${n(p.entryX!)} Y${n(p.entryY!)}; opening ${n(p.entryDiameter!)} mm; depth ${n(p.entryDepth!)} mm from starting top)`
    )
  for (const area of keepOuts)
    lines.push(
      `(Facing keep-out: ${area.name}; cutter radius plus ${n(area.margin)} mm clearance)`
    )
  for (let layer = 1; layer <= layers; layer++) {
    const cutZ = p.top - Math.min(p.removal, layer * p.stepdown)
    if (p.entryMode === "pocket") {
      for (const path of pocket.paths) {
        lines.push(
          `G0 Z${n(safe)}`,
          `G0 X${n(p.entryX!)} Y${n(p.entryY!)}`,
          `G1 Z${n(cutZ)} F${n(p.plunge)}`
        )
        for (const point of path.slice(1))
          lines.push(`G1 X${n(point[0])} Y${n(point[1])} F${n(p.feed)}`)
        lines.push(`G0 Z${n(safe)}`)
      }
      continue
    }
    if (p.pattern !== "vertical") lines.push(...outsideLayer(p, keepOuts, cutZ))
    if (p.pattern === "vertical" || p.pattern === "cross-hatch")
      lines.push(
        ...outsideLayer(transposeParams(p), transposeAreas(keepOuts), cutZ).map(
          (line) =>
            line.replace(/\b([XY])(?=[+-]?\d)/g, (_, axis: string) =>
              axis === "X" ? "Y" : "X"
            )
        )
      )
  }
  lines.push("M5", "M30")
  return lines.join("\n")
}
