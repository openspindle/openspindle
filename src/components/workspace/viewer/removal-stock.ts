import * as THREE from "three"
import type { RemovalGrid } from "@/domain/tools/material-removal"
import type { ViewerPlate } from "./viewer-input"

/** Reusable height-field buffers; flat quadtree leaves share a boundary-preserving fan. */
export class RemovalStockGeometry extends THREE.BufferGeometry {
  private readonly columns: number
  private readonly rows: number
  private readonly points: Float32Array
  private readonly normals: Float32Array
  private readonly triangles: Uint32Array
  private readonly uvs: Float32Array
  /** Two object-space face normals per cell, shared by the surface material. */
  readonly normalMap: THREE.DataTexture

  constructor(plate: ViewerPlate, grid: RemovalGrid) {
    super()
    this.columns = grid.columns
    this.rows = grid.rows
    const { columns, rows } = grid
    const cells = columns * rows
    // Each flat leaf with a centre contains at least two cells. Walls have four
    // independent vertices per edge, so their normals never round the stock top.
    const vertices =
      (columns + 1) * (rows + 1) + Math.floor(cells / 2) + 8 * (columns + rows)
    this.uvs = new Float32Array(vertices * 2)
    this.normalMap = new THREE.DataTexture(
      new Uint8Array(columns * rows * 8),
      columns * 2,
      rows
    )
    this.normalMap.minFilter = THREE.NearestFilter
    this.normalMap.magFilter = THREE.NearestFilter
    this.normalMap.generateMipmaps = false
    this.setAttribute(
      "uv",
      new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage)
    )
    this.points = new Float32Array(vertices * 3)
    this.normals = new Float32Array(vertices * 3)
    // A two-cell flat fan is the worst case: nine indices per cell, plus walls.
    this.triangles = new Uint32Array(9 * cells + 12 * (columns + rows))
    this.setAttribute(
      "position",
      new THREE.BufferAttribute(this.points, 3).setUsage(THREE.DynamicDrawUsage)
    )
    this.setAttribute(
      "normal",
      new THREE.BufferAttribute(this.normals, 3).setUsage(
        THREE.DynamicDrawUsage
      )
    )
    this.setIndex(
      new THREE.BufferAttribute(this.triangles, 1).setUsage(
        THREE.DynamicDrawUsage
      )
    )
    this.update(plate, grid)
  }

  matches(grid: RemovalGrid) {
    return grid.columns === this.columns && grid.rows === this.rows
  }

  update(plate: ViewerPlate, grid: RemovalGrid) {
    const stock = plate.stock!
    const { columns, rows, heights } = grid
    const stride = columns + 1
    const dx = stock.width / columns
    const dy = stock.depth / rows
    const [ox, oy, oz] = plate.stockAnchor
    let vertex = stride * (rows + 1)
    let index = 0
    const point = (
      id: number,
      x: number,
      y: number,
      z: number,
      nx: number,
      ny: number,
      nz: number
    ) => {
      const at = id * 3
      this.points[at] = x
      this.points[at + 1] = y
      this.points[at + 2] = z
      this.normals[at] = nx
      this.normals[at + 1] = ny
      this.normals[at + 2] = nz
      this.uvs[id * 2] = (x - ox) / stock.width
      this.uvs[id * 2 + 1] = (y - oy) / stock.depth
    }
    const triangle = (a: number, b: number, c: number) => {
      this.triangles[index++] = a
      this.triangles[index++] = b
      this.triangles[index++] = c
    }
    for (let row = 0; row <= rows; row++)
      for (let column = 0; column <= columns; column++) {
        const left = Math.max(0, column - 1)
        const right = Math.min(columns, column + 1)
        const front = Math.max(0, row - 1)
        const back = Math.min(rows, row + 1)
        const nx =
          -(heights[row * stride + right] - heights[row * stride + left]) /
          ((right - left) * dx)
        const ny =
          -(
            heights[back * stride + column] - heights[front * stride + column]
          ) /
          ((back - front) * dy)
        const length = Math.hypot(nx, ny, 1)
        const id = row * stride + column
        point(
          id,
          ox + column * dx,
          oy + row * dy,
          oz + heights[id],
          nx / length,
          ny / length,
          1 / length
        )
      }

    // Store each triangle's actual slope, without averaging across cut edges.
    // The shader selects the same diagonal as quad(), even inside a flat fan.
    const pixels = this.normalMap.image.data as Uint8Array
    const writeNormal = (at: number, nx: number, ny: number) => {
      const length = Math.hypot(nx, ny, 1)
      pixels[at] = Math.round(((nx / length) * 0.5 + 0.5) * 255)
      pixels[at + 1] = Math.round(((ny / length) * 0.5 + 0.5) * 255)
      pixels[at + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255)
      pixels[at + 3] = 255
    }
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const a = row * stride + column
        const h00 = heights[a]
        const h10 = heights[a + 1]
        const h01 = heights[a + stride]
        const h11 = heights[a + stride + 1]
        const at = (row * columns + column) * 8
        writeNormal(at, -(h10 - h00) / dx, -(h11 - h10) / dy)
        writeNormal(at + 4, -(h11 - h01) / dx, -(h01 - h00) / dy)
      }
    this.normalMap.needsUpdate = true

    const flat = (x0: number, y0: number, x1: number, y1: number) => {
      const height = heights[y0 * stride + x0]
      // Keep a dense ring beside cuts: tilted boundary normals must not be
      // interpolated across a large flat fan and smear the engraving's lighting.
      for (let y = Math.max(0, y0 - 1); y <= Math.min(rows, y1 + 1); y++)
        for (let x = Math.max(0, x0 - 1); x <= Math.min(columns, x1 + 1); x++)
          if (heights[y * stride + x] !== height) return false
      return true
    }
    const quad = (x0: number, y0: number, x1: number, y1: number) => {
      if (x1 - x0 === 1 && y1 - y0 === 1) {
        const a = y0 * stride + x0
        triangle(a, a + 1, a + stride + 1)
        triangle(a, a + stride + 1, a + stride)
        return
      }
      if (flat(x0, y0, x1, y1)) {
        const centre = vertex++
        point(
          centre,
          ox + ((x0 + x1) * dx) / 2,
          oy + ((y0 + y1) * dy) / 2,
          oz + heights[y0 * stride + x0],
          0,
          0,
          1
        )
        // Include every grid edge point, so differently sized neighbours meet
        // exactly without cracks or interpolating away a narrow cut.
        for (let x = x0; x < x1; x++) {
          triangle(centre, y0 * stride + x, y0 * stride + x + 1)
          triangle(centre, y1 * stride + x + 1, y1 * stride + x)
        }
        for (let y = y0; y < y1; y++) {
          triangle(centre, y * stride + x1, (y + 1) * stride + x1)
          triangle(centre, (y + 1) * stride + x0, y * stride + x0)
        }
        return
      }
      const mx = Math.floor((x0 + x1) / 2)
      const my = Math.floor((y0 + y1) / 2)
      if (x1 - x0 > 1 && y1 - y0 > 1) {
        quad(x0, y0, mx, my)
        quad(mx, y0, x1, my)
        quad(x0, my, mx, y1)
        quad(mx, my, x1, y1)
      } else if (x1 - x0 > 1) {
        quad(x0, y0, mx, y1)
        quad(mx, y0, x1, y1)
      } else {
        quad(x0, y0, x1, my)
        quad(x0, my, x1, y1)
      }
    }
    quad(0, 0, columns, rows)

    const topIndices = index
    const side = (a: number, b: number, nx: number, ny: number) => {
      const start = vertex
      for (const [id, bottom] of [
        [a, false],
        [b, false],
        [a, true],
        [b, true],
      ] as const) {
        point(
          vertex++,
          this.points[id * 3],
          this.points[id * 3 + 1],
          bottom ? oz : this.points[id * 3 + 2],
          nx,
          ny,
          0
        )
      }
      // Side UVs use the same millimetre scale as the top, with height vertical.
      for (let id = start; id < vertex; id++) {
        const along =
          nx === 0 ? this.points[id * 3] - ox : this.points[id * 3 + 1] - oy
        this.uvs[id * 2] = along / stock.width
        this.uvs[id * 2 + 1] = (this.points[id * 3 + 2] - oz) / stock.depth
      }
      triangle(start, start + 2, start + 3)
      triangle(start, start + 3, start + 1)
    }
    for (let column = 0; column < columns; column++) {
      side(column, column + 1, 0, -1)
      const back = rows * stride + column
      side(back + 1, back, 0, 1)
    }
    for (let row = 0; row < rows; row++) {
      const left = row * stride
      side(left + stride, left, -1, 0)
      side(left + columns, left + stride + columns, 1, 0)
    }
    this.clearGroups()
    this.addGroup(0, topIndices, 0)
    this.addGroup(topIndices, index - topIndices, 1)
    this.setDrawRange(0, index)
    this.getAttribute("uv").needsUpdate = true
    this.getAttribute("position").needsUpdate = true
    this.getAttribute("normal").needsUpdate = true
    this.index!.needsUpdate = true
    this.boundingBox = new THREE.Box3(
      new THREE.Vector3(ox, oy, oz),
      new THREE.Vector3(ox + stock.width, oy + stock.depth, oz + stock.height)
    )
    this.boundingSphere = this.boundingBox.getBoundingSphere(new THREE.Sphere())
  }
}
