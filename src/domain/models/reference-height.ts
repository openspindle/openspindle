import type { ReferenceModel } from "./reference"

/** Rasterize the upper envelope only. Underhangs and side faces are not inspected. */
export function referenceHeights(
  model: ReferenceModel,
  min: readonly number[],
  max: readonly number[],
  columns: number,
  rows: number
) {
  const target = new Float32Array((columns + 1) * (rows + 1)).fill(NaN)
  const dx = (max[0] - min[0]) / columns,
    dy = (max[1] - min[1]) / rows
  const [rx, ry, rz] = model.rotation.map((v) => (v * Math.PI) / 180)
  const [sx, sy, sz] = [Math.sin(rx), Math.sin(ry), Math.sin(rz)]
  const [cx, cy, cz] = [Math.cos(rx), Math.cos(ry), Math.cos(rz)]
  const transform = (values: readonly number[], index: number) => {
    const x = values[index] * model.scale,
      y = values[index + 1] * model.scale,
      z = values[index + 2] * model.scale
    // Three.js Euler XYZ: Rz acts first, then Ry, then Rx.
    const a = cz * x - sz * y,
      b = sz * x + cz * y
    const c = cy * a + sy * z,
      d = -sy * a + cy * z
    return [
      c + model.offset[0],
      cx * b - sx * d + model.offset[1],
      sx * b + cx * d + model.offset[2],
    ]
  }
  let visits = 0
  for (const part of model.parts) {
    const points: Array<number[]> = []
    for (let i = 0; i < part.positions.length; i += 3)
      points.push(transform(part.positions, i))
    for (let i = 0; i < part.indices.length; i += 3) {
      const a = points[part.indices[i]],
        b = points[part.indices[i + 1]],
        c = points[part.indices[i + 2]]
      const determinant =
        (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
      if (Math.abs(determinant) < 1e-12) continue
      const x0 = Math.max(
        0,
        Math.ceil((Math.min(a[0], b[0], c[0]) - min[0]) / dx)
      )
      const x1 = Math.min(
        columns,
        Math.floor((Math.max(a[0], b[0], c[0]) - min[0]) / dx)
      )
      const y0 = Math.max(
        0,
        Math.ceil((Math.min(a[1], b[1], c[1]) - min[1]) / dy)
      )
      const y1 = Math.min(
        rows,
        Math.floor((Math.max(a[1], b[1], c[1]) - min[1]) / dy)
      )
      if (x1 < x0 || y1 < y0) continue
      visits += (x1 - x0 + 1) * (y1 - y0 + 1)
      if (visits > 32_000_000)
        throw new Error(
          "Model comparison exceeds its calculation budget. Lower removal resolution or simplify the reference model."
        )
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = min[0] + x * dx,
            py = min[1] + y * dy
          const u =
            ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) /
            determinant
          const v =
            ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) /
            determinant
          if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue
          const z = u * a[2] + v * b[2] + (1 - u - v) * c[2] - min[2]
          const at = y * (columns + 1) + x
          if (!Number.isFinite(target[at]) || z > target[at]) target[at] = z
        }
    }
  }
  return target
}
