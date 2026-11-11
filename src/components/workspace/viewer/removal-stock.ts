import * as THREE from "three"
import type { RemovalGrid } from "@/domain/tools/material-removal"
import type { ViewerPlate } from "./viewer-input"

/** Sampled top and perimeter of the remaining stock, placed directly in bed coordinates. */
export function removalStock(
  plate: ViewerPlate,
  grid: RemovalGrid
): THREE.BufferGeometry {
  const stock = plate.stock!
  const { columns, rows, heights } = grid
  const points: number[] = []
  const indices: number[] = []
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++) {
      points.push(
        plate.stockAnchor[0] + (stock.width * column) / columns,
        plate.stockAnchor[1] + (stock.depth * row) / rows,
        plate.stockAnchor[2] + heights[row * (columns + 1) + column]
      )
    }
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column
      const b = a + 1
      const c = a + columns + 1
      const d = c + 1
      indices.push(a, b, d, a, d, c)
    }
  const side = (a: number, b: number) => {
    const bottomA = points.length / 3
    points.push(points[a * 3], points[a * 3 + 1], plate.stockAnchor[2])
    const bottomB = points.length / 3
    points.push(points[b * 3], points[b * 3 + 1], plate.stockAnchor[2])
    indices.push(a, bottomA, bottomB, a, bottomB, b)
  }
  for (let column = 0; column < columns; column++) {
    side(column, column + 1)
    const back = rows * (columns + 1) + column
    side(back + 1, back)
  }
  for (let row = 0; row < rows; row++) {
    const left = row * (columns + 1)
    side(left + columns + 1, left)
    side(left + columns, left + 2 * columns + 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}
