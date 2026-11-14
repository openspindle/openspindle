import * as THREE from "three"
import { materialFinish } from "./material-finish"
import { normalMap, step, texture, uv, vec2 } from "three/tsl"
import type { SurfaceFinish } from "@/domain/materials/surface-material"
import type { Stock } from "@/domain/stock/stock"
import type { RemovalStockGeometry } from "./removal-stock"

type Face = SurfaceFinish & { readonly color: THREE.Color }

/** Face-normal lighting stays discontinuous at the sampled cut's actual creases. */
export function removalSurfaces(
  stock: Stock,
  geometry: RemovalStockGeometry,
  top: Face,
  body: Face,
  deviation = false
) {
  const material = (face: Face) =>
    materialFinish(stock.material, face.color, stock.appearance, face)
  const surface = material(top)
  if (deviation) {
    surface.colorNode = texture(geometry.deviationMap, uv()).rgb
    surface.metalness = 0
    surface.roughness = 0.8
    surface.roughnessNode = null
  }
  // A standard texture slot keeps ownership visible to disposeMaterials.
  surface.emissiveMap = geometry.deviationMap

  const { width, height } = geometry.normalMap.image
  const dimensions = vec2(width / 2, height)
  const sample = uv().mul(dimensions).clamp(vec2(0), dimensions.sub(0.0001))
  const cell = sample.floor()
  const local = sample.fract()
  // Each cell's two texels correspond to its two triangles, not its left/right halves.
  const triangle = step(local.y, local.x).oneMinus()
  const lookup = vec2(
    cell.x.mul(2).add(triangle).add(0.5),
    cell.y.add(0.5)
  ).div(vec2(width, height))
  surface.normalMap = geometry.normalMap // Own/dispose it with the material.
  surface.normalMapType = THREE.ObjectSpaceNormalMap
  const normals = normalMap(texture(geometry.normalMap, lookup))
  normals.normalMapType = THREE.ObjectSpaceNormalMap
  surface.normalNode = normals
  return [surface, material(body)]
}
