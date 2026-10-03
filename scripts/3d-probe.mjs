#!/usr/bin/env node
/**
 * Writes the Makera 3D Probe model that its catalog tool is drawn with:
 *
 *   node scripts/3d-probe.mjs
 *
 * In millimetres, Z up, as tools are: the tip of the ruby ball at the origin and the axis along
 * Z, with the 1/8″ shank fitted and no cable plugged in. The dimensions are estimated from
 * Makera's product photos, scaled by the shank's known diameter; the Ø2 mm ball, the M2 stylus's
 * Ø3 mm base and the USB-C port agree with that scale. Makera publishes none. The GLB is written by
 * the app's own writer (src/formats/models/glb.ts), in glTF's metres, Y up.
 */
import { writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { writeGlbParts } from "../src/formats/models/glb.ts"

/** The ruby ball, on an M2 stylus: a Ø1 stem, a taper and the Ø3 base it is screwed in by. */
const BALL = { radius: 1 }
const STYLUS = { stem: 0.5, taper: 6.4, base: 1.5, baseBottom: 8.4, top: 11.4 }
/** The hexagon the stylus screws into, under the body. */
const NUT = { acrossFlats: 4, top: 13.2 }
/**
 * The stainless body, its edges chamfered, split by the LED ring. Four set screws ring its upper
 * half; the cable's port faces the back (+Y) above the ring.
 */
const BODY = {
  radius: 8.85,
  bottom: 13.2,
  chamfer: 0.9,
  top: 34.7,
  topChamfer: 0.6,
}
const RING = { bottom: 24.2, top: 25.6, proud: 0.05 }
const SCREWS = { radius: 0.8, height: 32.1 }
/** A thin collar on the body's top, then the shank's neck and the 1/8″ shank. */
const COLLAR = { radius: 5.2, top: 35 }
const SHANK = { neck: 1.25, neckTop: 37, radius: 3.175 / 2, top: 45.5, round: 0.5 }
/** Facets around the axis. */
const SEGMENTS = 48
/** Arc steps per quarter circle. */
const QUARTER = 8

/** glTF metallic-roughness finishes; colours are linear RGB. */
const STAINLESS = { color: [0.55, 0.57, 0.6], metallic: 0.6, roughness: 0.32 }
const STEEL = { color: [0.4, 0.43, 0.48], metallic: 0.55, roughness: 0.3 }
const RUBY = { color: [0.5, 0.03, 0.12], metallic: 0, roughness: 0.12 }
/** The LED ring's frosted diffuser, which glows green while the probe is ready. */
const DIFFUSER = { color: [0.3, 0.55, 0.32], metallic: 0, roughness: 0.4 }
const HOLE = { color: [0.012, 0.012, 0.014], metallic: 0.2, roughness: 0.6 }

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

/** An arc's points with their normals, from its centre, for `lathe`'s `smooth`. */
const arcNormals = (points, center) =>
  points.map(([r, z]) => normalize([r - center[0], z - center[1]]))

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

/** A prism of `outline` (points and normals, counter-clockwise seen from above) from z0 to z1. */
function extrude(target, outline, z0, z1) {
  const first = target.positions.length / 3
  for (const { point, normal } of outline)
    for (const z of [z0, z1]) {
      target.positions.push(point[0], point[1], z)
      target.normals.push(normal[0], normal[1], 0)
    }
  const count = outline.length
  for (let index = 0; index < count; index++) {
    const [low, high] = [first + index * 2, first + index * 2 + 1]
    const next = first + ((index + 1) % count) * 2
    // Counter-clockwise seen from outside.
    target.indices.push(low, next, next + 1, low, next + 1, high)
  }
  const points = outline.map(({ point }) => point)
  cap(target, points, z0, false)
  cap(target, points, z1, true)
}

/** A regular polygon's outline with a normal per face, so its edges stay sharp. */
function polygon(sides, apothem, turn = 0) {
  const corner = apothem / Math.cos(Math.PI / sides)
  return Array.from({ length: sides }, (_, face) => {
    const angles = [face, face + 1].map(
      (index) => turn + ((index - 0.5) * 2 * Math.PI) / sides
    )
    const middle = turn + (face * 2 * Math.PI) / sides
    return angles.map((angle) => ({
      point: [corner * Math.cos(angle), corner * Math.sin(angle)],
      normal: [Math.cos(middle), Math.sin(middle)],
    }))
  }).flat()
}

/** A flat disc of `radius` about `center`, facing `normal` in the XY plane: a hole's dark mouth. */
function disc(target, center, [nx, ny], radius, segments = 20) {
  const first = target.positions.length / 3
  target.positions.push(...center)
  target.normals.push(nx, ny, 0)
  for (let step = 0; step < segments; step++) {
    const angle = (2 * Math.PI * step) / segments
    // Across the face: its tangent in XY, then Z; their cross product is the normal.
    const [u, v] = [Math.cos(angle), Math.sin(angle)]
    target.positions.push(
      center[0] - ny * radius * u,
      center[1] + nx * radius * u,
      center[2] + radius * v
    )
    target.normals.push(nx, ny, 0)
  }
  for (let step = 0; step < segments; step++)
    target.indices.push(
      first,
      first + 1 + step,
      first + 1 + ((step + 1) % segments)
    )
}

// The ruby ball, whole: its tip at the origin.
const ruby = mesh()
const sphere = arc([0, BALL.radius], BALL.radius, -Math.PI / 2, Math.PI / 2)
lathe(ruby, sphere, {
  segments: 32,
  smooth: arcNormals(sphere, [0, BALL.radius]),
})

// The stylus from inside the ball up to its base, then the hexagon it screws into.
const stylus = mesh()
lathe(stylus, [
  [0, BALL.radius],
  [STYLUS.stem, BALL.radius],
  [STYLUS.stem, STYLUS.taper],
  [STYLUS.base, STYLUS.baseBottom],
  [STYLUS.base, STYLUS.top],
  [0, STYLUS.top],
])
extrude(stylus, polygon(6, NUT.acrossFlats / 2), STYLUS.top, NUT.top)

// The body in two halves, chamfered at its bottom and top, with the collar on it.
const body = mesh()
lathe(body, [
  [0, BODY.bottom],
  [BODY.radius - BODY.chamfer, BODY.bottom],
  [BODY.radius, BODY.bottom + BODY.chamfer],
  [BODY.radius, RING.bottom],
  [0, RING.bottom],
])
lathe(body, [
  [0, RING.top],
  [BODY.radius, RING.top],
  [BODY.radius, BODY.top - BODY.topChamfer],
  [BODY.radius - BODY.topChamfer, BODY.top],
  [COLLAR.radius, BODY.top],
  [COLLAR.radius, COLLAR.top],
  [0, COLLAR.top],
])

// The LED ring's diffuser between the halves, a hair proud of them.
const diffuser = mesh()
lathe(diffuser, [
  [0, RING.bottom],
  [BODY.radius + RING.proud, RING.bottom],
  [BODY.radius + RING.proud, RING.top],
  [0, RING.top],
])

// The set screws' holes, between the port's side and the others.
const holes = mesh()
for (let screw = 0; screw < 4; screw++) {
  const angle = Math.PI / 4 + (screw * Math.PI) / 2
  const [nx, ny] = [Math.cos(angle), Math.sin(angle)]
  const radius = BODY.radius + 0.01
  disc(holes, [nx * radius, ny * radius, SCREWS.height], [nx, ny], SCREWS.radius)
}

// The shank's neck and the 1/8″ shank, its end rounded.
const shank = mesh()
const end = arc(
  [SHANK.radius - SHANK.round, SHANK.top - SHANK.round],
  SHANK.round,
  0,
  Math.PI / 2
)
lathe(
  shank,
  [
    [0, COLLAR.top],
    [SHANK.neck, COLLAR.top],
    [SHANK.neck, SHANK.neckTop],
    [SHANK.radius, SHANK.neckTop],
    ...end,
    [0, SHANK.top],
  ],
  {
    smooth: [
      null,
      null,
      null,
      null,
      ...arcNormals(end, [SHANK.radius - SHANK.round, SHANK.top - SHANK.round]),
      [0, 1],
    ],
  }
)

const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/models/makera-3d-probe.glb"
)
await writeFile(
  output,
  writeGlbParts(
    [
      { name: "Ruby ball", mesh: ruby, material: RUBY },
      { name: "Stylus", mesh: stylus, material: STEEL },
      { name: "Body", mesh: body, material: STAINLESS },
      { name: "LED ring", mesh: diffuser, material: DIFFUSER },
      { name: "Set screw holes", mesh: holes, material: HOLE },
      { name: "Shank", mesh: shank, material: STEEL },
    ],
    {
      name: "Makera 3D Probe",
      generator: "OpenSpindle 3D probe (scripts/3d-probe.mjs)",
      extras: {
        dimensions: "estimated from Makera's product photos",
        overallLengthMm: SHANK.top,
        shankDiameterMm: 2 * SHANK.radius,
        ballDiameterMm: 2 * BALL.radius,
        coordinates: "meters, Y-up; the tip at the origin, the axis along +Y",
      },
    }
  )
)
console.log(`Wrote ${output}`)
