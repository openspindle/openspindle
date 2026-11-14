import { toolKindKey } from "@/domain/tools/tool"
import type {
  ProbeProfile,
  Tool,
  ToolGeometry,
  ToolShaft,
} from "@/domain/tools/tool"

/*
 * A tool as a solid of revolution, built from its dimensions (Fusion 360's tool model:
 * cutting diameter, flute length, shoulder, shaft segments, shank and overall length). The
 * tool library draws it, the 3D view moves it along a toolpath, and a cut simulation or a
 * collision check can use the same parts. The tool's holder is not part of it.
 *
 * Millimetres. Heights are above the tool's tip, the point a program moves; radii are from
 * the tool's axis.
 */

/** A point of an outline: its radius from the axis and its height above the tip. */
export type ProfilePoint = readonly [radius: number, height: number]

/**
 * The flutes cut (a probe's are its ball, which touches); the shaft (neck and shank) must not
 * touch the work.
 */
export type ToolPartRole = "flutes" | "shaft"

/** A solid of revolution: its outline, from the axis at its bottom to the axis at its top. */
export type ToolPart = {
  readonly role: ToolPartRole
  readonly outline: readonly ProfilePoint[]
}

export type ToolShape = {
  /** From the tip up: the flutes, then the shaft. */
  readonly parts: readonly ToolPart[]
  /** Height of the top above the tip. */
  readonly length: number
  /** The widest radius of any part. */
  readonly radius: number
  /** The record gives no length for the tool, so its shank is drawn at a nominal length. */
  readonly nominalLength: boolean
}

/** What a shape is built from: a library tool, or the editor's draft of one. */
export type ToolShapeSource = Pick<
  Tool,
  "kind" | "diameter" | "geometry" | "shaft"
> & { readonly probe?: Pick<ProbeProfile, "contact"> | null }

/** Outline points per quarter circle of a rounded corner. */
const QUARTER_STEPS = 12
/**
 * Without a known length, the shank reaches this many of its diameters above the tip, and
 * at least this many above the neck and shaft segments.
 */
const NOMINAL_SHANK = { aboveTip: 10, aboveNeck: 4 }
/** A thread mill is drawn with at most this many teeth. */
const MAX_TEETH = 100
/** A shaft is drawn with at most this many segments. */
const MAX_SHAFT_SEGMENTS = 100

/** A positive length, or null for an unknown, zero or invalid value. */
function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null
}

/** An angle strictly between 0° and `limit`°, in radians; null for any other value. */
function angle(degrees: number | null, limit: number): number | null {
  const value = positive(degrees)
  return value !== null && value < limit ? (value * Math.PI) / 180 : null
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * Points of a circular arc of `radius` around `center`, from angle `from` to angle `to`:
 * radians counterclockwise from the outward direction.
 */
function arc(
  center: ProfilePoint,
  radius: number,
  from: number,
  to: number
): ProfilePoint[] {
  const steps = Math.max(
    1,
    Math.ceil((Math.abs(to - from) / (Math.PI / 2)) * QUARTER_STEPS)
  )
  return Array.from({ length: steps + 1 }, (_, index): ProfilePoint => {
    const theta = from + ((to - from) * index) / steps
    return [
      center[0] + radius * Math.cos(theta),
      center[1] + radius * Math.sin(theta),
    ]
  })
}

/** The cutting end's outline from the tip's centre up to the top of its side. */
type Cutter = { readonly outline: ProfilePoint[]; readonly top: number }

type Dimensions = {
  /** Cutting radius. */
  readonly radius: number
  /** Shank radius; the cutting radius when unknown. */
  readonly shank: number
  /** Flute length, when known. */
  readonly flutes: number | null
  readonly geometry: ToolGeometry
}

/**
 * A flat end of radius `tip` whose corner is rounded by `corner`, with sides that widen at
 * `taper` (radians from the axis; 0 for straight sides) up to `top`.
 */
function roundedEnd(
  tip: number,
  corner: number,
  taper: number,
  top: number
): Cutter {
  const rounding = clamp(corner, 0, tip)
  const flat = tip - rounding
  const outline: ProfilePoint[] = [
    [0, 0],
    [flat, 0],
  ]
  if (rounding > 0)
    outline.push(...arc([flat, rounding], rounding, -Math.PI / 2, -taper))
  const [radius, height] = outline[outline.length - 1]
  const end = Math.max(top, height)
  outline.push([radius + (end - height) * Math.tan(taper), end])
  return { outline, top: end }
}

/** A point of `included` angle up to the full radius, then straight sides up to `top`. */
function pointed(radius: number, included: number, top: number): Cutter {
  const height = radius / Math.tan(included / 2)
  const end = Math.max(top, height)
  return {
    outline: [
      [0, 0],
      [radius, height],
      [radius, end],
    ],
    top: end,
  }
}

/**
 * A cone from a flat tip of radius `tip`, widening at `taper` from the axis until `widest`,
 * then straight; it ends at `top`, or where it reaches `widest` when `top` is unknown (one
 * diameter up when it is as wide at the tip).
 */
function cone(
  tip: number,
  widest: number,
  taper: number,
  top: number | null
): Cutter {
  const full = Math.max(widest, tip)
  const reach = (full - tip) / Math.tan(taper)
  const end = top ?? (reach > 0 ? reach : 2 * full)
  const outline: ProfilePoint[] = [
    [0, 0],
    [tip, 0],
  ]
  if (reach < end) outline.push([full, reach], [full, end])
  else outline.push([tip + end * Math.tan(taper), end])
  return { outline, top: end }
}

/** A corner-rounding cutter: a tip of radius `tip`, then a concave quarter circle outwards. */
function concaveRadius(
  tip: number,
  corner: number,
  tipLength: number,
  top: number | null
): Cutter {
  const outline: ProfilePoint[] = [
    [0, 0],
    [tip, 0],
    [tip, tipLength],
    ...arc([tip + corner, tipLength], corner, Math.PI, Math.PI / 2),
  ]
  const side = tipLength + corner
  const end = Math.max(top ?? side, side)
  outline.push([tip + corner, end])
  return { outline, top: end }
}

/** Thread-forming teeth of `pitch` and profile angle `included` from the tip up. */
function teeth(
  radius: number,
  pitch: number,
  included: number,
  count: number,
  top: number | null
): Cutter {
  const depth = Math.min(pitch / 2 / Math.tan(included / 2), radius * 0.8)
  const root = radius - depth
  const outline: ProfilePoint[] = [
    [0, 0],
    [root, 0],
  ]
  for (let tooth = 0; tooth < count; tooth++)
    outline.push([radius, (tooth + 0.5) * pitch], [root, (tooth + 1) * pitch])
  const end = Math.max(top ?? count * pitch, count * pitch)
  outline.push([root, end])
  return { outline, top: end }
}

/** A ball of `radius` that meets a neck of radius `neck` above its equator. */
function sphere(radius: number, neck: number): Cutter {
  const meet = Math.acos(clamp(neck / radius, 0, 0.99))
  return {
    outline: arc([0, radius], radius, -Math.PI / 2, meet),
    top: radius + radius * Math.sin(meet),
  }
}

/** A cutter that narrows at `taper` from its full radius at the tip up to `top`. */
function dovetail(radius: number, taper: number, top: number): Cutter {
  return {
    outline: [
      [0, 0],
      [radius, 0],
      [Math.max(radius - top * Math.tan(taper), radius * 0.2), top],
    ],
    top,
  }
}

/** Flutes of unknown length are drawn one cutting diameter long. */
const fluteLength = ({ flutes, radius }: Dimensions) => flutes ?? 2 * radius

/** Flat and bull nose end mills and any unlisted type: flat, rounded by the corner radius. */
const endMill = (dimensions: Dimensions) =>
  roundedEnd(
    dimensions.radius,
    positive(dimensions.geometry.cornerRadius) ?? 0,
    0,
    fluteLength(dimensions)
  )

/**
 * Chamfer mills and countersinks: the taper, or half the included angle, from a tip; a flat
 * end without either.
 */
const chamfer = (dimensions: Dimensions) => {
  const { geometry } = dimensions
  const taper =
    angle(geometry.taperAngle, 90) ?? (angle(geometry.pointAngle, 180) ?? 0) / 2
  if (!taper) return endMill(dimensions)
  return cone(
    Math.min(positive(geometry.tipDiameter) ?? 0, 2 * dimensions.radius) / 2,
    dimensions.radius,
    taper,
    dimensions.flutes
  )
}

/** Drills: the point angle, or a flat end when it is unknown. */
const drill = (dimensions: Dimensions) => {
  const point = angle(dimensions.geometry.pointAngle, 180)
  if (point === null) return endMill(dimensions)
  return pointed(dimensions.radius, point, fluteLength(dimensions))
}

/**
 * Tapered mills: the tip's diameter, its shape (the tapered tip: a flat, a ball or a bull
 * nose of the corner radius) and the taper towards the shank.
 */
const tapered = (dimensions: Dimensions, ball: boolean) => {
  const { geometry, radius } = dimensions
  const tip = toolKindKey(geometry.taperedTip ?? "")
  let corner = positive(geometry.cornerRadius) ?? (ball ? radius : 0)
  if (tip === "ball") corner = radius
  else if (tip === "flat") corner = 0
  return roundedEnd(
    radius,
    corner,
    angle(geometry.taperAngle, 90) ?? 0,
    fluteLength(dimensions)
  )
}

/**
 * Lollipop mills and probes: a ball on a neck (a probe's stylus) of the shoulder diameter, or
 * of the shank without one.
 */
const ballOnNeck = (dimensions: Dimensions) =>
  sphere(
    dimensions.radius,
    (positive(dimensions.geometry.shoulderDiameter) ?? 0) / 2 ||
      dimensions.shank
  )

/**
 * Cutting ends by tool type (compared loosely, as `toolKindKey` does). The types are Fusion
 * 360's, plus the V-bit "engraving" type, whose diameter is its tip's. A probe's diameter is
 * its ball's.
 */
const CUTTERS: Readonly<Record<string, (dimensions: Dimensions) => Cutter>> = {
  "ball end mill": (dimensions) =>
    roundedEnd(
      dimensions.radius,
      dimensions.radius,
      0,
      fluteLength(dimensions)
    ),
  "tapered mill": (dimensions) => tapered(dimensions, false),
  "tapered ball end mill": (dimensions) => tapered(dimensions, true),
  drill,
  "spot drill": drill,
  "center drill": drill,
  "chamfer mill": chamfer,
  "counter sink": chamfer,
  engraving: (dimensions) => {
    const { geometry, radius, shank } = dimensions
    const taper =
      angle(geometry.taperAngle, 90) ??
      (angle(geometry.pointAngle, 180) ?? 0) / 2
    if (!taper) return endMill(dimensions)
    const tip = Math.min(
      positive(geometry.tipDiameter) ?? 2 * radius,
      2 * radius
    )
    return cone(tip / 2, Math.max(radius, shank), taper, dimensions.flutes)
  },
  "radius mill": (dimensions) => {
    const { geometry, radius } = dimensions
    const corner = positive(geometry.cornerRadius)
    if (corner === null) return endMill(dimensions)
    return concaveRadius(
      radius,
      corner,
      positive(geometry.tipLength) ?? 0,
      dimensions.flutes
    )
  },
  "thread mill": (dimensions) => {
    const { geometry, radius } = dimensions
    const pitch =
      positive(geometry.threadPitchMax) ?? positive(geometry.threadPitchMin)
    const profile = angle(geometry.threadProfileAngle, 180)
    if (pitch === null || profile === null) return endMill(dimensions)
    const count = clamp(Math.round(geometry.numberOfTeeth ?? 1), 1, MAX_TEETH)
    return teeth(radius, pitch, profile, count, dimensions.flutes)
  },
  "lollipop mill": ballOnNeck,
  "dovetail mill": (dimensions) => {
    const taper = angle(dimensions.geometry.taperAngle, 90)
    if (taper === null) return endMill(dimensions)
    return dovetail(dimensions.radius, taper, fluteLength(dimensions))
  },
  probe: ballOnNeck,
}

/** Points this close are one point; rounding leaves arcs' ends a hair off their corners. */
const SAME_POINT = 1e-9

/** Consecutive repeats removed, so every outline edge has a length. */
function distinct(points: readonly ProfilePoint[]): ProfilePoint[] {
  return points.filter(
    (point, index) =>
      index === 0 ||
      Math.abs(point[0] - points[index - 1][0]) > SAME_POINT ||
      Math.abs(point[1] - points[index - 1][1]) > SAME_POINT
  )
}

/**
 * The shaft's segments that have a height and a diameter, with the one diameter given at
 * both ends where only one is.
 */
function shaftProfile(shaft: ToolShaft) {
  return shaft.segments.slice(0, MAX_SHAFT_SEGMENTS).flatMap((segment) => {
    const height = positive(segment.height)
    const lower =
      positive(segment.lowerDiameter) ?? positive(segment.upperDiameter)
    const upper = positive(segment.upperDiameter) ?? lower
    if (height === null || lower === null || upper === null) return []
    return [{ height, lower, upper }]
  })
}

function buildShape({
  kind,
  diameter,
  geometry,
  shaft: profile,
  probe,
}: ToolShapeSource): ToolShape | null {
  const cutting = positive(diameter)
  if (cutting === null) return null
  const shank = (positive(geometry.shankDiameter) ?? cutting) / 2
  const shape =
    toolKindKey(kind) === "probe" && probe?.contact === "conductive"
      ? endMill
      : (CUTTERS[toolKindKey(kind)] ?? endMill)
  const cutter = shape({
    radius: cutting / 2,
    shank,
    flutes: positive(geometry.fluteLength),
    geometry,
  })
  const [sideRadius] = cutter.outline[cutter.outline.length - 1]
  const parts: ToolPart[] = [
    {
      role: "flutes",
      outline: distinct([...cutter.outline, [0, cutter.top]]),
    },
  ]
  // The neck between the flutes and the shoulder, then the shaft's segments from the
  // shoulder up, then the shank.
  const shoulder = positive(geometry.shoulderLength)
  const neckTop =
    shoulder !== null && shoulder > cutter.top ? shoulder : cutter.top
  const neckRadius =
    (positive(geometry.shoulderDiameter) ?? 0) / 2 || sideRadius
  const shaft: ProfilePoint[] = [[0, cutter.top]]
  if (neckTop > cutter.top)
    shaft.push([neckRadius, cutter.top], [neckRadius, neckTop])
  let profileTop = neckTop
  for (const { height, lower, upper } of shaftProfile(profile)) {
    shaft.push([lower / 2, profileTop], [upper / 2, profileTop + height])
    profileTop += height
  }
  const known = positive(geometry.overallLength)
  const nominal = Math.max(
    NOMINAL_SHANK.aboveTip * 2 * shank,
    profileTop + NOMINAL_SHANK.aboveNeck * 2 * shank
  )
  const shankTop = Math.max(known ?? nominal, profileTop)
  if (shankTop > profileTop) shaft.push([shank, profileTop], [shank, shankTop])
  if (shaft.length > 1) {
    shaft.push([0, shankTop])
    parts.push({ role: "shaft", outline: distinct(shaft) })
  }
  const top = parts[parts.length - 1].outline
  return {
    parts,
    length: top[top.length - 1][1],
    radius: Math.max(
      ...parts.flatMap((part) => part.outline.map(([radius]) => radius))
    ),
    nominalLength: known === null,
  }
}

const shapes = new WeakMap<ToolShapeSource, ToolShape | null>()

/**
 * The shape a tool's dimensions describe, or null without a cutting diameter. Missing
 * dimensions fall back to the ones given (a shank of the cutting diameter, flutes one
 * diameter long, a nominal length) and inconsistent ones are clamped, so an edited draft
 * always draws. Cached per tool object; tools and drafts are immutable values.
 */
export function toolShape(tool: ToolShapeSource): ToolShape | null {
  if (shapes.has(tool)) return shapes.get(tool) ?? null
  const shape = buildShape(tool)
  shapes.set(tool, shape)
  return shape
}
