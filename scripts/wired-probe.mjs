#!/usr/bin/env node
/**
 * Writes the Makera Wired Probe 2.0 model that its catalog tool is drawn with:
 *
 *   node scripts/wired-probe.mjs
 *
 * In millimetres, Z up, as tools are: the tip at the origin and the axis along Z, with the 1/8″
 * shank adapter fitted. The dimensions are estimated from Makera's product photos, scaled by the
 * adapters' known diameters; Makera publishes none. The GLB is written by the app's own writer
 * (src/formats/models/glb.ts), in glTF's metres, Y up.
 */
import { writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { writeGlbParts } from "../src/formats/models/glb.ts"

/** The gold-plated contact pin: a ball end on a pin reaching below the nose. */
const PIN = { radius: 0.75, top: 4 }
/** The steel nose: its end chamfered from the pin's hole, a seam near its end. */
const NOSE = { radius: 3, end: 1.75, chamfer: 1.5, seam: 10.4, top: 20.5 }
/** The black anodized body, centred on the axis, its vertical edges rounded. */
const BODY = { width: 10, depth: 12, top: 44.5, round: 1, bevel: 0.4 }
/** The cable block on the body's side, its outer lower edge cut away. */
const CABLE_BLOCK = { width: 4.5, depth: 10, bottom: 28, cut: 3.5 }
/**
 * The cable leaves the cable block upwards through a strain relief, then bends away to the
 * back (+Y) and is cut off there.
 */
const CABLE = {
  radius: 1.3,
  relief: 2,
  reliefTop: 47,
  rise: 2.5,
  bend: 4,
  run: 4,
}
/** The shank adapter: a flange on the body, a relief groove, then the 1/8″ shank. */
const ADAPTER = {
  flange: 4,
  flangeTop: 45.5,
  groove: 1.3,
  grooveTop: 47,
  shank: 3.175 / 2,
  top: 56,
  chamfer: 0.3,
}
/** Facets around the axis. */
const SEGMENTS = 48
/** Arc steps per quarter circle. */
const QUARTER = 8

/** glTF metallic-roughness finishes; colours are linear RGB. */
const STEEL = { color: [0.4, 0.43, 0.48], metallic: 0.55, roughness: 0.3 }
const GOLD = { color: [0.69, 0.4, 0.08], metallic: 0.6, roughness: 0.3 }
const ANODIZED = {
  color: [0.019, 0.021, 0.025],
  metallic: 0.35,
  roughness: 0.45,
}
const RUBBER = { color: [0.007, 0.007, 0.007], metallic: 0, roughness: 0.65 }

function mesh() {
  return { positions: [], normals: [], indices: [] }
}

function normalize([x, y, z = 0]) {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}

/**
 * An outline turned about a vertical axis through `center`. The outline runs from the axis at
 * its bottom to the axis at its top, as [radius, z] points; each band between two points has
 * its own vertices, so the outline's corners stay sharp. A band's normals are outward across it,
 * or `smooth` gives each point its own (an arc's, from its centre).
 */
function lathe(
  target,
  outline,
  { center = [0, 0], segments = SEGMENTS, smooth } = {}
) {
  for (let band = 0; band < outline.length - 1; band++) {
    const from = outline[band]
    const to = outline[band + 1]
    const flat = normalize([to[1] - from[1], -(to[0] - from[0])])
    const ends = [smooth?.[band] ?? flat, smooth?.[band + 1] ?? flat]
    const first = target.positions.length / 3
    for (let step = 0; step <= segments; step++) {
      const angle = (2 * Math.PI * step) / segments
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
      ;[from, to].forEach(([radius, z], end) => {
        const [nr, nz] = ends[end]
        target.positions.push(
          center[0] + radius * cos,
          center[1] + radius * sin,
          z
        )
        target.normals.push(nr * cos, nr * sin, nz)
      })
    }
    for (let step = 0; step < segments; step++) {
      const [low, high] = [first + step * 2, first + step * 2 + 1]
      // Counter-clockwise seen from outside; a band ending on the axis makes one triangle.
      if (from[0] > 0) target.indices.push(low, low + 2, high + 2)
      if (to[0] > 0) target.indices.push(low, high + 2, high)
    }
  }
}

/**
 * Points of an arc of `radius` about `center`, from angle `from` to `to`; coordinates within
 * rounding of zero are zero, so an arc that starts on the axis starts exactly there.
 */
function arc(center, radius, from, to) {
  const steps = Math.max(
    1,
    Math.ceil((Math.abs(to - from) / (Math.PI / 2)) * QUARTER)
  )
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = from + ((to - from) * index) / steps
    return [Math.cos(angle), Math.sin(angle)].map((value, axis) => {
      const coordinate = center[axis] + radius * value
      return Math.abs(coordinate) < 1e-9 ? 0 : coordinate
    })
  })
}

/**
 * A rounded rectangle's outline, counter-clockwise seen from above, with each point's outward
 * normal: corners of `round` about the rectangle [x0, x1] × [y0, y1].
 */
function roundedRectangle(x0, x1, y0, y1, round) {
  const corners = [
    [x1 - round, y0 + round, -Math.PI / 2],
    [x1 - round, y1 - round, 0],
    [x0 + round, y1 - round, Math.PI / 2],
    [x0 + round, y0 + round, Math.PI],
  ]
  return corners.flatMap(([cx, cy, start]) =>
    arc([0, 0], 1, start, start + Math.PI / 2).map(([nx, ny]) => ({
      point: [cx + round * nx, cy + round * ny],
      normal: [nx, ny],
    }))
  )
}

/** A closed ring of outline points at `z` (each point once), for `band`. */
function ring(outline, z, normal) {
  return outline.map(({ point, normal: [nx, ny] }) => ({
    position: [point[0], point[1], z],
    normal: normalize(normal(nx, ny)),
  }))
}

/** A band between two rings of equal length, counter-clockwise seen from outside. */
function band(target, lower, upper) {
  const first = target.positions.length / 3
  for (const { position, normal } of [...lower, ...upper]) {
    target.positions.push(...position)
    target.normals.push(...normal)
  }
  const count = lower.length
  for (let index = 0; index < count; index++) {
    const next = (index + 1) % count
    target.indices.push(first + index, first + next, first + count + next)
    target.indices.push(
      first + index,
      first + count + next,
      first + count + index
    )
  }
}

/** A flat convex cap over `points` (counter-clockwise seen from above), facing up or down. */
function cap(target, points, z, up) {
  const first = target.positions.length / 3
  for (const [x, y] of points) {
    target.positions.push(x, y, z)
    target.normals.push(0, 0, up ? 1 : -1)
  }
  for (let index = 1; index < points.length - 1; index++)
    if (up) target.indices.push(first, first + index, first + index + 1)
    else target.indices.push(first, first + index + 1, first + index)
}

/** A block of `outline` from z0 to z1, its top and bottom edges bevelled by `bevel`. */
function block(target, [x0, x1, y0, y1], [z0, z1], round, bevel) {
  const full = roundedRectangle(x0, x1, y0, y1, round)
  const inset = roundedRectangle(
    x0 + bevel,
    x1 - bevel,
    y0 + bevel,
    y1 - bevel,
    round - bevel
  )
  const side = (nx, ny) => [nx, ny, 0]
  band(
    target,
    ring(inset, z0, (nx, ny) => [nx, ny, -1]),
    ring(full, z0 + bevel, (nx, ny) => [nx, ny, -1])
  )
  band(target, ring(full, z0 + bevel, side), ring(full, z1 - bevel, side))
  band(
    target,
    ring(full, z1 - bevel, (nx, ny) => [nx, ny, 1]),
    ring(inset, z1, (nx, ny) => [nx, ny, 1])
  )
  const points = inset.map(({ point }) => point)
  cap(target, points, z0, false)
  cap(target, points, z1, true)
}

/**
 * A prism of a convex polygon in the XZ plane (counter-clockwise seen from −Y), from y0 to y1:
 * flat faces with sharp edges.
 */
function prism(target, polygon, y0, y1) {
  polygon.forEach(([xa, za], index) => {
    const [xb, zb] = polygon[(index + 1) % polygon.length]
    const normal = normalize([zb - za, 0, -(xb - xa)])
    const first = target.positions.length / 3
    for (const [x, y, z] of [
      [xa, y0, za],
      [xb, y0, zb],
      [xb, y1, zb],
      [xa, y1, za],
    ]) {
      target.positions.push(x, y, z)
      target.normals.push(...normal)
    }
    // Counter-clockwise seen from outside.
    target.indices.push(
      first,
      first + 2,
      first + 1,
      first,
      first + 3,
      first + 2
    )
  })
  for (const [y, facing] of [
    [y0, -1],
    [y1, 1],
  ]) {
    const first = target.positions.length / 3
    for (const [x, z] of polygon) {
      target.positions.push(x, y, z)
      target.normals.push(0, facing, 0)
    }
    for (let index = 1; index < polygon.length - 1; index++)
      if (facing < 0)
        target.indices.push(first, first + index, first + index + 1)
      else target.indices.push(first, first + index + 1, first + index)
  }
}

/**
 * A tube of `radius` along a path in a plane x = constant, closed by a flat cap at its end;
 * its start is left open, inside what it leaves.
 */
function tube(target, path, radius, segments = 24) {
  const first = target.positions.length / 3
  path.forEach((point, index) => {
    const [, ay, az] = path[Math.max(0, index - 1)]
    const [, by, bz] = path[Math.min(path.length - 1, index + 1)]
    const [ty, tz] = normalize([by - ay, bz - az])
    // Around the path: its normal in the plane (ty, tz turned a quarter), and the X axis.
    const normal = [0, tz, -ty]
    for (let step = 0; step <= segments; step++) {
      const angle = (2 * Math.PI * step) / segments
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
      const direction = [sin, normal[1] * cos, normal[2] * cos]
      target.positions.push(
        ...point.map((value, axis) => value + radius * direction[axis])
      )
      target.normals.push(...direction)
    }
  })
  const ring = segments + 1
  for (let index = 0; index < path.length - 1; index++)
    for (let step = 0; step < segments; step++) {
      const low = first + index * ring + step
      const high = low + ring
      target.indices.push(low, high, high + 1, low, high + 1, low + 1)
    }
  const end = path[path.length - 1]
  const [, py, pz] = path[path.length - 2]
  const [ty, tz] = normalize([end[1] - py, end[2] - pz])
  const last = target.positions.length / 3
  for (let step = 0; step < segments; step++) {
    const angle = (2 * Math.PI * step) / segments
    const direction = [
      Math.sin(angle),
      tz * Math.cos(angle),
      -ty * Math.cos(angle),
    ]
    target.positions.push(
      ...end.map((value, axis) => value + radius * direction[axis])
    )
    target.normals.push(0, ty, tz)
  }
  for (let step = 1; step < segments - 1; step++)
    target.indices.push(last, last + step + 1, last + step)
}

// The contact pin: a ball end, then the pin up into the nose.
const pin = mesh()
const ball = arc([0, PIN.radius], PIN.radius, -Math.PI / 2, 0)
lathe(pin, [...ball, [PIN.radius, PIN.top], [0, PIN.top]], {
  segments: 24,
  smooth: [...ball.map(([r, z]) => normalize([r, z - PIN.radius])), null, null],
})

// The nose, then the adapter on the body's top.
const steel = mesh()
const chamferTop = PIN.top + NOSE.chamfer
lathe(steel, [
  [0, PIN.top],
  [NOSE.end, PIN.top],
  [NOSE.radius, chamferTop],
  [NOSE.radius, NOSE.seam - 0.2],
  [NOSE.radius - 0.2, NOSE.seam],
  [NOSE.radius, NOSE.seam + 0.2],
  [NOSE.radius, NOSE.top],
  [0, NOSE.top],
])
lathe(steel, [
  [0, BODY.top],
  [ADAPTER.flange, BODY.top],
  [ADAPTER.flange, ADAPTER.flangeTop],
  [ADAPTER.groove, ADAPTER.flangeTop],
  [ADAPTER.groove, ADAPTER.grooveTop],
  [ADAPTER.shank, ADAPTER.grooveTop],
  [ADAPTER.shank, ADAPTER.top - ADAPTER.chamfer],
  [ADAPTER.shank - ADAPTER.chamfer, ADAPTER.top],
  [0, ADAPTER.top],
])

// The body, and the cable block on its −X side.
const body = mesh()
const [halfWidth, halfDepth] = [BODY.width / 2, BODY.depth / 2]
block(
  body,
  [-halfWidth, halfWidth, -halfDepth, halfDepth],
  [NOSE.top, BODY.top],
  BODY.round,
  BODY.bevel
)
const outer = -halfWidth - CABLE_BLOCK.width
prism(
  body,
  [
    [-halfWidth, CABLE_BLOCK.bottom],
    [-halfWidth, BODY.top],
    [outer, BODY.top],
    [outer, CABLE_BLOCK.bottom + CABLE_BLOCK.cut],
    [outer + CABLE_BLOCK.cut, CABLE_BLOCK.bottom],
  ],
  -CABLE_BLOCK.depth / 2,
  CABLE_BLOCK.depth / 2
)

// The cable leaves the cable block's top, then bends away to the back.
const cable = mesh()
const cableX = -halfWidth - CABLE_BLOCK.width / 2
const reliefEnd = CABLE.reliefTop + 0.8
lathe(
  cable,
  [
    [0, BODY.top],
    [CABLE.relief, BODY.top],
    [CABLE.relief, CABLE.reliefTop],
    [CABLE.radius, reliefEnd],
    [0, reliefEnd],
  ],
  { center: [cableX, 0], segments: 24 }
)
const bendStart = reliefEnd + CABLE.rise
const bend = arc([CABLE.bend, bendStart], CABLE.bend, Math.PI, Math.PI / 2)
tube(
  cable,
  [
    [0, reliefEnd],
    ...bend,
    [CABLE.bend + CABLE.run, bendStart + CABLE.bend],
  ].map(([y, z]) => [cableX, y, z]),
  CABLE.radius
)

const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/models/makera-wired-probe-2.glb"
)
await writeFile(
  output,
  writeGlbParts(
    [
      { name: "Contact pin", mesh: pin, material: GOLD },
      { name: "Nose and shank adapter", mesh: steel, material: STEEL },
      { name: "Body", mesh: body, material: ANODIZED },
      { name: "Cable", mesh: cable, material: RUBBER },
    ],
    {
      name: "Makera Wired Probe 2.0",
      generator: "Spinnvill wired probe (scripts/wired-probe.mjs)",
      extras: {
        dimensions: "estimated from Makera's product photos",
        overallLengthMm: ADAPTER.top,
        shankDiameterMm: 2 * ADAPTER.shank,
        coordinates: "meters, Y-up; the tip at the origin, the axis along +Y",
      },
    }
  )
)
console.log(`Wrote ${output}`)
