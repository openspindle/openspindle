#!/usr/bin/env node
/**
 * Writes the Makera Z1 dowel pin model, a 4 × 11 mm turned pin with chamfered ends:
 *
 *   node scripts/dowel-pin.mjs
 *
 * In millimetres, Z up, its bottom face at Z 0; the GLB is written by the app's own writer
 * (src/formats/models/glb.ts), like the bed models. The fixture definition's offset sets how deep
 * it sits in the bed.
 */
import { writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { writeGlb } from "../src/formats/models/glb.ts"

const DIAMETER = 4
const LENGTH = 11
const CHAMFER = 0.4
const SEGMENTS = 32

const radius = DIAMETER / 2
const slope = Math.SQRT1_2
/** The pin's outline from the bottom centre to the top centre: [radius, z], and each band's outward normal. */
const bands = [
  { from: [0, 0], to: [radius - CHAMFER, 0], normal: [0, -1] },
  {
    from: [radius - CHAMFER, 0],
    to: [radius, CHAMFER],
    normal: [slope, -slope],
  },
  { from: [radius, CHAMFER], to: [radius, LENGTH - CHAMFER], normal: [1, 0] },
  {
    from: [radius, LENGTH - CHAMFER],
    to: [radius - CHAMFER, LENGTH],
    normal: [slope, slope],
  },
  { from: [radius - CHAMFER, LENGTH], to: [0, LENGTH], normal: [0, 1] },
]

const positions = []
const normals = []
const indices = []
for (const band of bands) {
  // Each band has its own vertices, so its normal stays flat across the chamfer edges.
  const first = positions.length / 3
  for (let step = 0; step <= SEGMENTS; step++) {
    const angle = (2 * Math.PI * step) / SEGMENTS
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
    for (const [r, z] of [band.from, band.to]) {
      positions.push(r * cos, r * sin, z)
      normals.push(band.normal[0] * cos, band.normal[0] * sin, band.normal[1])
    }
  }
  for (let step = 0; step < SEGMENTS; step++) {
    const [from, to] = [first + step * 2, first + step * 2 + 1]
    const [nextFrom, nextTo] = [from + 2, to + 2]
    // Counter-clockwise seen from outside; the caps' centre points make one triangle each.
    if (band.from[0] > 0) indices.push(from, nextFrom, nextTo)
    if (band.to[0] > 0) indices.push(from, nextTo, to)
  }
}

const output = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/models/makera-z1-dowel-pin.glb"
)
await writeFile(
  output,
  writeGlb(
    { positions, normals, indices },
    {
      name: "Makera Z1 dowel pin 4 × 11 mm",
      generator: "Spinnvill dowel pin (scripts/dowel-pin.mjs)",
      color: [0.55, 0.58, 0.61],
      extras: {
        diameterMm: DIAMETER,
        lengthMm: LENGTH,
        chamferMm: CHAMFER,
        coordinates: "meters, Y-up",
      },
    }
  )
)
console.log(`Wrote ${output}`)
