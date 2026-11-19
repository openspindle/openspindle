import { PatternSpecSchema } from "@/domain/operations/pattern"
import type { PatternLayer, PatternSpec } from "@/domain/operations/pattern"
import type { Point3 } from "@/domain/nc/gcode"
import { generatePattern } from "./pattern-core"
import type { PatternOutput } from "./pattern-core"

export const PATTERN_COLOR = "#0088bf"
export type PreviewLayer = {
  color: string
  index: number
  paths: Point3[][]
  mask?: boolean
  cutterDiameter?: number
}
export type LayeredOutput = PatternOutput & { layers: PreviewLayer[] }
type Mask = {
  index: number
  color: string
  outlines: Point3[][]
  contains: (x: number, y: number, clearance: number) => boolean
}
type Settings = Pick<PatternSpec, "tool" | "rpm" | "feed" | "plunge">
const PIXELS = 24
const STEP = 1 / PIXELS
const circle = (r: number, z: number, x = 0, y = 0): Point3[] =>
  Array.from({ length: 721 }, (_, i) => {
    const a = (i * Math.PI) / 360
    return [x + r * Math.cos(a), y + r * Math.sin(a), z]
  })

/** Rasterize each numeral separately and retain its ink as horizontal runs in world coordinates. */
function dialMask(
  layer: Extract<PatternLayer, { kind: "dial-mask" }>,
  index: number
): Mask {
  const canvas = new OffscreenCanvas(
    Math.ceil((layer.size * 3 + 1) * PIXELS),
    Math.ceil((layer.size * 2 + 1) * PIXELS)
  )
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("The dial font could not be rendered.")
  ctx.font = `${layer.size * PIXELS}px ${layer.font}`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  const { width, height } = canvas
  const outlines: Point3[][] = []
  const digits = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6
    const x0 = layer.radius * Math.sin(a) - (width * STEP) / 2
    const y0 = layer.radius * Math.cos(a) + (height * STEP) / 2
    ctx.clearRect(0, 0, width, height)
    ctx.fillText(String(i || 12), width / 2, height / 2)
    const ink = ctx.getImageData(0, 0, width, height).data
    const rows: [number, number][][] = []
    for (let row = 0; row < height; row++) {
      const runs: [number, number][] = []
      for (let col = 0; col < width;) {
        if (!ink[(row * width + col) * 4 + 3]) {
          col++
          continue
        }
        const begin = col
        do col++
        while (col < width && ink[(row * width + col) * 4 + 3])
        runs.push([begin, col])
        // Preview the actual ink footprint independently of cutting moves.
        if (row % 3 === 0)
          outlines.push([
            [x0 + begin * STEP, y0 - row * STEP, 0],
            [x0 + col * STEP, y0 - row * STEP, 0],
          ])
      }
      rows.push(runs)
    }
    return { x0, y0, rows }
  })
  return {
    color: layer.color,
    index,
    outlines,
    contains: (x, y, clearance) =>
      digits.some(({ x0, y0, rows }) => {
        const cx = (x - x0) * PIXELS
        const cy = (y0 - y) * PIXELS
        const pad = clearance * PIXELS
        if (
          cx + pad < 0 ||
          cx - pad > width ||
          cy + pad < 0 ||
          cy - pad > height
        )
          return false
        const from = Math.max(0, Math.floor(cy - pad))
        const to = Math.min(height - 1, Math.floor(cy + pad))
        for (let row = from; row <= to; row++)
          if (rows[row].some(([a, b]) => cx + pad >= a && cx - pad <= b))
            return true
        return false
      }),
  }
}

function clip(
  paths: Point3[][],
  masks: Mask[],
  clearance: number,
  reject = false
): Point3[][] {
  if (!masks.length) return paths
  const clipped: Point3[][] = []
  let probes = 0
  for (const path of paths) {
    let piece: Point3[] = []
    for (let i = 1; i < path.length; i++) {
      const start = path[i - 1]
      const end = path[i]
      const dx = end[0] - start[0]
      const dy = end[1] - start[1]
      const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / STEP))
      probes += count
      if (probes > 2_000_000)
        throw new Error(
          "Mask clipping exceeds the sampling budget. Use fewer curves or a smaller pattern."
        )
      const at = (t: number): Point3 => [
        start[0] + dx * t,
        start[1] + dy * t,
        start[2] + (end[2] - start[2]) * t,
      ]
      // A step is accepted only if its midpoint has clearance for the whole step.
      let run = -1
      for (let k = 0; k <= count; k++) {
        const blocked =
          k === count ||
          masks.some((mask) => {
            const [x, y] = at((k + 0.5) / count)
            return mask.contains(x, y, clearance + STEP / 2 + 0.0001)
          })
        if (!blocked) {
          if (run < 0) run = k
          continue
        }
        if (run >= 0) {
          if (!piece.length) piece.push(at(run / count))
          piece.push(at(k / count))
          run = -1
        }
        if (k < count && reject)
          throw new Error(
            "The cutout crosses a mask. Move the mask or increase the cutout diameter."
          )
        if (k < count && piece.length) {
          clipped.push(piece)
          piece = []
        }
      }
    }
    if (piece.length) clipped.push(piece)
  }
  return clipped
}

export async function generateLayers(
  input: PatternSpec,
  baseUrl: string
): Promise<LayeredOutput> {
  const spec = PatternSpecSchema.parse(input)
  const layers = spec.layers ?? []
  const masks = layers.flatMap((layer, i): Mask[] => {
    const index = i + 1
    if (layer.kind === "dial-mask") return [dialMask(layer, index)]
    if (layer.kind !== "circle-mask") return []
    return [
      {
        color: layer.color,
        index,
        outlines: [circle(layer.radius, 0, layer.x, layer.y)],
        contains: (x, y, pad) =>
          Math.hypot(x - layer.x, y - layer.y) <= layer.radius + pad,
      },
    ]
  })
  const formulas = [
    { formula: spec, color: spec.color ?? PATTERN_COLOR, index: 0 },
    ...layers.flatMap((layer, i) =>
      layer.kind === "formula" ? [{ ...layer, index: i + 1 }] : []
    ),
  ]
  const outputs = await Promise.all(
    formulas.map(async ({ formula, color, index }) => ({
      index,
      result: await generatePattern(formula, baseUrl),
      settings: formula,
      color,
    }))
  )
  const work: (PreviewLayer & { settings: Settings })[] = outputs.map(
    ({ result, settings, color, index }) => ({
      index,
      color,
      settings,
      paths: clip(
        result.generated.paths as Point3[][],
        masks,
        spec.maskClearance ?? 0.5
      ),
    })
  )
  for (const [i, layer] of layers.entries()) {
    if (layer.kind !== "cutout") continue
    const depth = layer.thickness + layer.breakthrough
    const passes = Math.ceil(depth / layer.stepDown)
    if (passes * 721 > 90_000)
      throw new Error("Use fewer cutout passes by increasing the step-down.")
    const paths = Array.from({ length: passes }, (_, pass) =>
      circle(
        layer.radius + layer.diameter / 2,
        -Math.min(depth, (pass + 1) * layer.stepDown)
      )
    )
    clip([paths[0]], masks, layer.diameter / 2, true)
    work.push({
      paths,
      index: i + 1,
      color: layer.color,
      settings: layer,
      cutterDiameter: layer.diameter,
    })
  }
  const active = work.filter((layer) => layer.paths.length > 0)
  const combinedPaths = active.flatMap((layer) => layer.paths)
  const points = combinedPaths.reduce((sum, path) => sum + path.length, 0)
  if (!points) throw new Error("No cutting paths remain outside the masks.")
  if (points > 90_000)
    throw new Error("The combined layers exceed 90,000 points.")
  const min: Point3 = [Infinity, Infinity, Infinity]
  const max: Point3 = [-Infinity, -Infinity, -Infinity]
  const preview: PreviewLayer[] = []
  const lines = [
    "(Parametric engraving; verify stock top Z0, cutter and clearances)",
    "G21 G90 G17 G94",
  ]
  const n = (v: number) => v.toFixed(4)
  // Use one clearance throughout, including between layers with different cutters.
  const safeZ = Math.max(...formulas.map(({ formula }) => formula.safeZ))
  for (const { paths, color, settings, cutterDiameter, index } of active) {
    lines.push(`T${settings.tool} M6`, `S${settings.rpm} M3`, `G0 Z${n(safeZ)}`)
    for (const path of paths) {
      const [x, y, z] = path[0]
      lines.push(`G0 X${n(x)} Y${n(y)}`, `G1 Z${n(z)} F${n(settings.plunge)}`)
      for (const [px, py, pz] of path.slice(1))
        lines.push(`G1 X${n(px)} Y${n(py)} Z${n(pz)} F${n(settings.feed)}`)
      lines.push(`G0 Z${n(safeZ)}`)
      for (const point of path)
        for (const axis of [0, 1, 2] as const) {
          min[axis] = Math.min(min[axis], point[axis])
          max[axis] = Math.max(max[axis], point[axis])
        }
    }
    lines.push("M5")
    preview.push({
      color,
      paths,
      index,
      cutterDiameter,
    })
  }
  lines.push("M30")
  for (const mask of masks)
    preview.push({
      color: mask.color,
      index: mask.index,
      paths: mask.outlines,
      mask: true,
    })
  return {
    generated: {
      paths: combinedPaths,
      min,
      max,
      points,
      gcode: lines.join("\n"),
    },
    layers: preview,
    engine: outputs[0].result.engine,
  }
}
