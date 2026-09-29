import type { GCodeSegment, Point3 } from "@/domain/nc/gcode"
import type { ProfilePoint } from "./tool-shape"
import { isProbeSlot } from "./tool-table"

/*
 * Depth and width of cut, predicted by removing the stock that a program's feed moves sweep.
 * The stock is a height field over its XY area (2.5D: nothing is cut from below), lowered
 * wherever a tool's lower surface passes beneath it. What a stretch of travel removes that
 * earlier moves left is its engagement: the axial depth of cut from the tool's tip up to the
 * highest stock it takes, and the radial width of cut across its direction of travel.
 *
 * Millimetres, in the program's coordinates (from the plate's work origin).
 */

/** How a line's moves meet the stock; when a line has several kinds, the last listed wins. */
export const LINE_CUTS = [
  /** The line moves nothing. */
  "none",
  /** Rapid moves only. */
  "rapid",
  /** The probes' moves (T0, and the 3D probe's slot). */
  "probe",
  /** Feed moves that remove nothing: above the stock, or where it is already cut away. */
  "air",
  /** Feed moves of a tool whose shape is unknown, so what they cut is too. */
  "unknown",
  /** Feed moves that remove stock. */
  "cut",
] as const
export type LineCutKind = (typeof LINE_CUTS)[number]

const RAPID = LINE_CUTS.indexOf("rapid")
const PROBE = LINE_CUTS.indexOf("probe")
const AIR = LINE_CUTS.indexOf("air")
const UNKNOWN = LINE_CUTS.indexOf("unknown")
const CUT = LINE_CUTS.indexOf("cut")

/** The tool that makes a stretch of the program's segments. */
export type CutToolSpan = {
  /** Half-open indices into the program's segments. */
  readonly segmentStart: number
  readonly segmentEnd: number
  /** The cutting end's outline from the tip up (the `ToolShape`'s flutes); null when unknown. */
  readonly flutes: readonly ProfilePoint[] | null
}

/** The stock as a box in the program's coordinates. */
export type CutStock = { readonly min: Point3; readonly max: Point3 }

export type CutSimulationInput = {
  readonly segments: readonly GCodeSegment[]
  readonly lineCount: number
  /** In program order, not overlapping. */
  readonly spans: readonly CutToolSpan[]
  /** Without stock, the stock is taken to reach down from Z0 wherever the program cuts. */
  readonly stock: CutStock | null
}

/** Per program line: the index is the one-based line, and 0 is unused. */
export type CutEngagement = {
  /** Indices into `LINE_CUTS`. */
  readonly kinds: Uint8Array
  /** The line's deepest axial depth of cut. */
  readonly depths: Float32Array
  /** The line's widest radial width of cut. */
  readonly widths: Float32Array
  /** How far below the stock top the line leaves the tool's tip: negative above it, NaN without moves. */
  readonly belowTop: Float32Array
  /** The height field's cell size, which is how accurate the width of a partial cut is. */
  readonly resolution: number
}

/** Samples of a tool's lower surface from its axis out. */
const PROFILE_SAMPLES = 256
/** Cells are at most this coarse, at least this fine, and at most this many. */
const COARSEST_CELL = 0.25
const FINEST_CELL = 0.01
const MAX_CELLS = 8_000_000
/** The narrowest engagement has this many cells across its radius, unless that is too many. */
const CELLS_PER_RADIUS = 6
/**
 * Cells a sweep of the whole program visits at most, about a second's work: the cells of a
 * long program with large tools coarsen to stay within it.
 */
const MAX_SWEPT_CELLS = 60_000_000
/** Less stock than this is float noise, or a cut that only grazes. */
const EPSILON = 0.001
/**
 * Travel measured at once, in cells: shorter moves are measured together, so that what they
 * remove is wide enough for the cells to show.
 */
const MEASURED_TRAVEL = 3

/** The height of a tool's lower surface above its tip, from its axis to its widest radius. */
type Profile = {
  readonly radius: number
  /** Samples per millimetre of radius. */
  readonly scale: number
  /** They never decrease outwards. */
  readonly heights: Float32Array
}

/** The lowest point of an outline at `radius` from the axis or beyond: its lower surface there. */
function lowestAt(outline: readonly ProfilePoint[], radius: number): number {
  let lowest = Infinity
  for (let index = 1; index < outline.length; index++) {
    const [r0, h0] = outline[index - 1]
    const [r1, h1] = outline[index]
    if (r0 < radius && r1 < radius) continue
    let height = Math.min(
      r0 >= radius ? h0 : Infinity,
      r1 >= radius ? h1 : Infinity
    )
    // An edge that crosses the radius is at least that wide from the crossing on.
    if (r0 < radius || r1 < radius)
      height = Math.min(height, h0 + ((h1 - h0) * (radius - r0)) / (r1 - r0))
    lowest = Math.min(lowest, height)
  }
  return lowest
}

function profileOf(outline: readonly ProfilePoint[] | null): Profile | null {
  if (!outline) return null
  const radius = Math.max(0, ...outline.map(([r]) => r))
  if (!(radius > 0 && Number.isFinite(radius))) return null
  const heights = new Float32Array(PROFILE_SAMPLES)
  for (let index = 0; index < PROFILE_SAMPLES; index++)
    heights[index] = lowestAt(outline, (radius * index) / (PROFILE_SAMPLES - 1))
  return { radius, scale: (PROFILE_SAMPLES - 1) / radius, heights }
}

/** The tool's lower surface `distance` from its axis; Infinity beyond its widest radius. */
function heightAt(profile: Profile, distance: number): number {
  if (distance > profile.radius) return Infinity
  const { heights } = profile
  const position = distance * profile.scale
  const index = Math.floor(position)
  if (index >= PROFILE_SAMPLES - 1) return heights[PROFILE_SAMPLES - 1]
  return (
    heights[index] + (heights[index + 1] - heights[index]) * (position - index)
  )
}

/** How far from its axis the tool reaches at `depth` above its tip; -1 below the tip. */
function reachAt(profile: Profile, depth: number): number {
  const { heights } = profile
  if (!(depth >= 0)) return -1
  if (heights[PROFILE_SAMPLES - 1] <= depth) return profile.radius
  let low = 0
  let high = PROFILE_SAMPLES - 1
  while (low < high) {
    const middle = (low + high) >>> 1
    if (heights[middle] > depth) high = middle
    else low = middle + 1
  }
  if (low === 0) return 0
  const below = heights[low - 1]
  const above = heights[low]
  const fraction = above > below ? (depth - below) / (above - below) : 0
  return (low - 1 + fraction) / profile.scale
}

/** The stock's height over the area the program cuts, in square cells. */
type HeightField = {
  readonly x0: number
  readonly y0: number
  readonly columns: number
  readonly rows: number
  readonly cell: number
  readonly heights: Float32Array
  readonly top: number
  readonly bottom: number
}

/** What a stretch of travel removes: gathered before the stock is lowered. */
type Engagement = {
  engaged: boolean
  /** The highest stock taken. */
  top: number
  /** Extent of the cells taken across the direction of travel, or along X without one. */
  low: number
  high: number
  /** Extent along Y, for travel without a direction (a plunge). */
  lowY: number
  highY: number
}

/**
 * The cells within `reach` of the segment's path, each with the tool's lower surface there:
 * gathered into `engagement` when one is given (across `normal`, measured from `originX`,
 * `originY`; along X and Y when `normal` is null), then lowered to it when `remove` is set.
 */
function sweep(
  field: HeightField,
  profile: Profile,
  segment: GCodeSegment,
  reach: number,
  engagement: Engagement | null,
  remove: boolean,
  originX: number,
  originY: number,
  normal: readonly [number, number] | null
) {
  const { x0, y0, columns, rows, cell, heights, bottom } = field
  const [ax, ay, az] = segment.start
  const [bx, by, bz] = segment.end
  const length = Math.hypot(bx - ax, by - ay)
  const plunge = length < 1e-9
  const ux = plunge ? 0 : (bx - ax) / length
  const uy = plunge ? 0 : (by - ay) / length
  const lowZ = Math.min(az, bz)
  const ramp = az !== bz
  const reach2 = reach * reach
  // A flat end reaches its whole width at the tip: no lookups.
  const flat = heightAt(profile, reach) === 0
  const firstRow = Math.max(
    0,
    Math.ceil((Math.min(ay, by) - reach - y0) / cell - 0.5)
  )
  const lastRow = Math.min(
    rows - 1,
    Math.floor((Math.max(ay, by) + reach - y0) / cell - 0.5)
  )
  for (let row = firstRow; row <= lastRow; row++) {
    const cy = y0 + (row + 0.5) * cell
    // The capsule around the path is convex, so a row of it is one interval: the union of
    // the discs at both ends and the band along the path.
    let left = Infinity
    let right = -Infinity
    const fromA = cy - ay
    if (Math.abs(fromA) <= reach) {
      const half = Math.sqrt(reach2 - fromA * fromA)
      left = ax - half
      right = ax + half
    }
    const fromB = cy - by
    if (Math.abs(fromB) <= reach) {
      const half = Math.sqrt(reach2 - fromB * fromB)
      left = Math.min(left, bx - half)
      right = Math.max(right, bx + half)
    }
    if (!plunge) {
      // In the band, 0 ≤ (p − a)·u ≤ length and |(p − a)·n| ≤ reach, with n = (−uy, ux).
      let low = -Infinity
      let high = Infinity
      const along = fromA * uy
      if (Math.abs(ux) > 1e-12) {
        const start = ax - along / ux
        const end = ax + (length - along) / ux
        low = Math.max(low, Math.min(start, end))
        high = Math.min(high, Math.max(start, end))
      } else if (along < 0 || along > length) high = -Infinity
      const across = fromA * ux
      if (Math.abs(uy) > 1e-12) {
        const start = ax + (across - reach) / uy
        const end = ax + (across + reach) / uy
        low = Math.max(low, Math.min(start, end))
        high = Math.min(high, Math.max(start, end))
      } else if (Math.abs(across) > reach) high = -Infinity
      if (low <= high) {
        left = Math.min(left, low)
        right = Math.max(right, high)
      }
    }
    if (left > right) continue
    const firstColumn = Math.max(0, Math.ceil((left - x0) / cell - 0.5))
    const lastColumn = Math.min(
      columns - 1,
      Math.floor((right - x0) / cell - 0.5)
    )
    let index = row * columns + firstColumn
    for (let column = firstColumn; column <= lastColumn; column++, index++) {
      const cx = x0 + (column + 0.5) * cell
      let surface: number
      if (plunge) {
        const offset = cx - ax
        const distance2 = offset * offset + fromA * fromA
        if (distance2 > reach2) continue
        surface = flat ? lowZ : lowZ + heightAt(profile, Math.sqrt(distance2))
      } else {
        const along = (cx - ax) * ux + fromA * uy
        const across = fromA * ux - (cx - ax) * uy
        const closest = Math.min(length, Math.max(0, along))
        const beyond = along - closest
        const distance2 = beyond * beyond + across * across
        if (distance2 > reach2) continue
        surface = az + ((bz - az) * closest) / length
        if (!flat) surface += heightAt(profile, Math.sqrt(distance2))
        if (ramp) {
          // On a ramp the tool reaches lowest towards one end of the stretch that covers
          // this cell, not where it passes closest.
          const across2 = across * across
          const spread = Math.sqrt(Math.max(0, reach2 - across2))
          for (let end = 0; end < 2; end++) {
            const t = end
              ? Math.min(length, along + spread)
              : Math.max(0, along - spread)
            const gap = along - t
            let lower = az + ((bz - az) * t) / length
            if (!flat)
              lower += heightAt(profile, Math.sqrt(gap * gap + across2))
            if (lower < surface) surface = lower
          }
        }
      }
      const floor = surface > bottom ? surface : bottom
      const height = heights[index]
      if (remove && floor < height) heights[index] = floor
      if (!engagement || !(height > floor + EPSILON)) continue
      engagement.engaged = true
      if (height > engagement.top) engagement.top = height
      if (normal) {
        const side = (cx - originX) * normal[0] + (cy - originY) * normal[1]
        if (side < engagement.low) engagement.low = side
        if (side > engagement.high) engagement.high = side
      } else {
        if (cx < engagement.low) engagement.low = cx
        if (cx > engagement.high) engagement.high = cx
        if (cy < engagement.lowY) engagement.lowY = cy
        if (cy > engagement.highY) engagement.highY = cy
      }
    }
  }
}

/** Feed moves cut, except the probes'; rapids are assumed to stay clear of the stock. */
const cuts = (segment: GCodeSegment) =>
  !segment.rapid && !isProbeSlot(segment.tool)

/**
 * The height field over where the program's cuts reach the stock, at a cell size that
 * resolves its narrowest cut unless that makes too many cells to sweep; null when no cut
 * reaches the stock.
 */
function heightField(
  input: CutSimulationInput,
  profiles: readonly (Profile | null)[],
  top: number,
  bottom: number
): HeightField | null {
  const min = [Infinity, Infinity]
  const max = [-Infinity, -Infinity]
  let narrowest = Infinity
  /** The area the cuts sweep, in square millimetres, counting overlaps. */
  let swept = 0
  input.spans.forEach((span, spanIndex) => {
    const profile = profiles[spanIndex]
    if (!profile) return
    for (let index = span.segmentStart; index < span.segmentEnd; index++) {
      const segment = input.segments[index]
      if (!cuts(segment)) continue
      const { start, end } = segment
      const reach = reachAt(profile, top - Math.min(start[2], end[2]))
      if (reach <= 0) continue
      narrowest = Math.min(narrowest, reach)
      const length = Math.hypot(end[0] - start[0], end[1] - start[1])
      swept += 2 * reach * length + Math.PI * reach * reach
      for (const axis of [0, 1]) {
        min[axis] = Math.min(min[axis], start[axis] - reach, end[axis] - reach)
        max[axis] = Math.max(max[axis], start[axis] + reach, end[axis] + reach)
      }
    }
  })
  const { stock } = input
  if (stock)
    for (const axis of [0, 1]) {
      min[axis] = Math.max(min[axis], stock.min[axis])
      max[axis] = Math.min(max[axis], stock.max[axis])
    }
  const width = max[0] - min[0]
  const depth = max[1] - min[1]
  if (!(width > 0 && depth > 0)) return null
  let cell = Math.max(
    Math.min(
      COARSEST_CELL,
      Math.max(FINEST_CELL, narrowest / CELLS_PER_RADIUS)
    ),
    Math.sqrt(swept / MAX_SWEPT_CELLS)
  )
  if ((width / cell) * (depth / cell) > MAX_CELLS)
    cell = Math.sqrt((width * depth) / MAX_CELLS) * 1.001
  const columns = Math.max(1, Math.ceil(width / cell))
  const rows = Math.max(1, Math.ceil(depth / cell))
  return {
    x0: min[0],
    y0: min[1],
    columns,
    rows,
    cell,
    heights: new Float32Array(columns * rows).fill(top),
    top,
    bottom,
  }
}

/** A cut's width across its travel: exact when it takes the tool's whole width at its depth. */
function widthOf(
  engagement: Engagement,
  profile: Profile,
  depth: number,
  cell: number,
  directed: boolean
): number {
  const full = 2 * reachAt(profile, depth)
  const extent = directed
    ? engagement.high - engagement.low
    : Math.max(
        engagement.high - engagement.low,
        engagement.highY - engagement.lowY
      )
  // Cell centres stop half a cell short of the cut's edges on either side.
  const width = extent + cell
  return width >= full - 1.5 * cell ? full : Math.min(width, full)
}

/**
 * Predicts every line's depth and width of cut by sweeping the stock with each tool's lower
 * surface, in program order.
 */
export function simulateCuts(input: CutSimulationInput): CutEngagement {
  const { segments, spans, stock } = input
  const size = input.lineCount + 1
  const kinds = new Uint8Array(size)
  const depths = new Float32Array(size)
  const widths = new Float32Array(size)
  const belowTop = new Float32Array(size).fill(Number.NaN)
  const top = stock ? stock.max[2] : 0
  const bottom = stock ? stock.min[2] : -Infinity
  const profiles = spans.map((span) => profileOf(span.flutes))
  const field = heightField(input, profiles, top, bottom)
  const mark = (line: number, kind: number) => {
    if (kind > kinds[line]) kinds[line] = kind
  }

  // Consecutive feed moves of one tool, [first, last), measured together and then removed.
  let first = -1
  let last = -1
  let travelled = 0
  let profile: Profile | null = null
  const flush = () => {
    if (first < 0 || !profile) return
    const from = segments[first].start
    const to = segments[last - 1].end
    const chord = Math.hypot(to[0] - from[0], to[1] - from[1])
    const directed = field !== null && chord >= field.cell / 2
    const normal: readonly [number, number] | null = directed
      ? [-(to[1] - from[1]) / chord, (to[0] - from[0]) / chord]
      : null
    const engagement: Engagement = {
      engaged: false,
      top: -Infinity,
      low: Infinity,
      high: -Infinity,
      lowY: Infinity,
      highY: -Infinity,
    }
    let lowest = Infinity
    for (let index = first; index < last; index++) {
      const { start, end } = segments[index]
      lowest = Math.min(lowest, start[2], end[2])
    }
    // One move is measured as it is removed; several are measured before any is, where
    // they overlap.
    const single = last - first === 1
    if (field)
      for (const pass of single ? ["both"] : ["measure", "remove"])
        for (let index = first; index < last; index++) {
          const { start, end } = segments[index]
          const reach = reachAt(profile, top - Math.min(start[2], end[2]))
          if (reach <= 0) continue
          sweep(
            field,
            profile,
            segments[index],
            reach,
            pass === "remove" ? null : engagement,
            pass !== "measure",
            from[0],
            from[1],
            normal
          )
        }
    const { engaged } = engagement
    const depth = engaged ? engagement.top - Math.max(lowest, bottom) : 0
    const width =
      engaged && field
        ? widthOf(engagement, profile, depth, field.cell, directed)
        : 0
    for (let index = first; index < last; index++) {
      const { line } = segments[index]
      mark(line, engaged ? CUT : AIR)
      if (depth > depths[line]) depths[line] = depth
      if (width > widths[line]) widths[line] = width
    }
    first = -1
    travelled = 0
  }

  let span = 0
  for (let index = 0; index < segments.length; index++) {
    while (span < spans.length && spans[span].segmentEnd <= index) span++
    const spanProfile =
      span < spans.length && spans[span].segmentStart <= index
        ? profiles[span]
        : null
    const segment = segments[index]
    const { line, start, end } = segment
    belowTop[line] = top - end[2]
    if (!cuts(segment) || !spanProfile) {
      flush()
      if (segment.rapid) mark(line, RAPID)
      else if (isProbeSlot(segment.tool)) mark(line, PROBE)
      else mark(line, UNKNOWN)
      continue
    }
    if (spanProfile !== profile) flush()
    profile = spanProfile
    if (first < 0) first = index
    last = index + 1
    travelled += Math.hypot(
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2]
    )
    if (!field || travelled >= MEASURED_TRAVEL * field.cell) flush()
  }
  flush()
  return { kinds, depths, widths, belowTop, resolution: field?.cell ?? 0 }
}

export type LineCut = {
  readonly kind: LineCutKind
  /** Axial and radial engagement; zero unless the line cuts. */
  readonly depth: number
  readonly width: number
  /** How far below the stock top the line leaves the tool's tip; null when it moves nothing. */
  readonly belowTop: number | null
}

/** How line `line` of the program meets the stock. */
export function lineCut(engagement: CutEngagement, line: number): LineCut {
  const inside = line >= 1 && line < engagement.kinds.length
  const kind = inside ? LINE_CUTS[engagement.kinds[line]] : "none"
  const below = inside ? engagement.belowTop[line] : Number.NaN
  return {
    kind,
    depth: kind === "cut" ? engagement.depths[line] : 0,
    width: kind === "cut" ? engagement.widths[line] : 0,
    belowTop: Number.isNaN(below) ? null : below,
  }
}
