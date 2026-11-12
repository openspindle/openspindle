import * as THREE from "three"
import { MeshStandardNodeMaterial } from "three/webgpu"
import { normalMap, step, texture, uv, vec2 } from "three/tsl"
import { surfaceMaterialOf } from "@/domain/materials/surface-material"
import type { SurfaceFinish } from "@/domain/materials/surface-material"
import type { Stock } from "@/domain/stock/stock"
import type { RemovalStockGeometry } from "./removal-stock"

type Face = SurfaceFinish & { readonly color: THREE.Color }

/** Subtle illustrative grain, not predicted tool marks or measured surface finish. */
function surfaceTexture(stock: Stock) {
  const size = 128
  const pixels = new Uint8Array(size * size * 4)
  const kind = surfaceMaterialOf(stock.material)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      // Deterministic, periodic texture: reopening a job does not change its finish.
      const noise = ((x * 73 + y * 151 + x * y * 19) % 127) / 126
      let grain = noise
      if (kind === "metal")
        grain = 0.8 * (0.5 + 0.5 * Math.sin((y * Math.PI) / 4)) + 0.2 * noise
      if (kind === "wood")
        grain =
          0.75 *
            (0.5 +
              0.5 *
                Math.sin(
                  (y * Math.PI) / 8 + 0.6 * Math.sin((x * Math.PI) / 64)
                )) +
          0.25 * noise
      const value = Math.round(244 + 11 * grain)
      const at = (y * size + x) * 4
      pixels[at] = pixels[at + 1] = pixels[at + 2] = value
      pixels[at + 3] = 255
    }
  const map = new THREE.DataTexture(pixels, size, size)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.magFilter = THREE.LinearFilter
  map.minFilter = THREE.LinearMipmapLinearFilter
  map.generateMipmaps = true
  // One tile per 8 mm, independent of removal sampling resolution.
  map.repeat.set(stock.width / 8, stock.depth / 8)
  map.needsUpdate = true
  return map
}

/** Face-normal lighting stays discontinuous at the sampled cut's actual creases. */
export function removalSurfaces(
  stock: Stock,
  geometry: RemovalStockGeometry,
  top: Face,
  body: Face
) {
  const map = surfaceTexture(stock)
  const material = (face: Face) =>
    new MeshStandardNodeMaterial({
      color: face.color,
      metalness: face.metalness,
      roughness: face.roughness,
      map,
      roughnessMap: map,
      side: THREE.DoubleSide,
    })
  const surface = material(top)
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
