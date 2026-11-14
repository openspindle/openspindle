import * as THREE from "three"
import { MeshPhysicalNodeMaterial } from "three/webgpu"
import { float, texture, triplanarTexture, uniform } from "three/tsl"
import { resolvedAppearance } from "@/domain/materials/appearance"
import type { MaterialAppearance } from "@/domain/materials/appearance"
import type { SurfaceFinish } from "@/domain/materials/surface-material"

/** Self-contained PBR material: mm-scale triplanar grain needs no authored UVs. */
export function materialFinish(
  name: string,
  color: THREE.Color,
  appearance?: MaterialAppearance,
  fallback?: SurfaceFinish
) {
  const finish = resolvedAppearance(name, appearance)
  if (fallback) {
    finish.metalness = appearance?.metalness ?? fallback.metalness
    finish.roughness = appearance?.roughness ?? fallback.roughness
  }
  const material = new MeshPhysicalNodeMaterial({
    color: appearance?.color ? new THREE.Color(appearance.color) : color,
    metalness: finish.metalness,
    roughness: finish.roughness,
    opacity: finish.opacity,
    transparent: finish.opacity < 1,
    depthWrite: finish.opacity === 1,
    clearcoat: finish.family === "plastic" ? 0.15 : 0,
    clearcoatRoughness: 0.3,
    ior: 1.49,
    side: THREE.DoubleSide,
  })
  if (finish.texture === "none" || finish.textureStrength === 0) return material
  const size = 128
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const noise = ((x * 73 + y * 151 + x * y * 19) % 127) / 126
      let grain = noise
      if (finish.texture === "brushed")
        grain = 0.8 * (0.5 + 0.5 * Math.sin((y * Math.PI) / 4)) + 0.2 * noise
      if (finish.texture === "grain")
        grain =
          0.75 *
            (0.5 +
              0.5 *
                Math.sin(
                  (y * Math.PI) / 8 + 0.6 * Math.sin((x * Math.PI) / 64)
                )) +
          0.25 * noise
      const at = (y * size + x) * 4
      pixels[at] = pixels[at + 1] = pixels[at + 2] = Math.round(255 * grain)
      pixels[at + 3] = 255
    }
  const map = new THREE.DataTexture(pixels, size, size)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.magFilter = THREE.LinearFilter
  map.minFilter = THREE.LinearMipmapLinearFilter
  map.generateMipmaps = true
  map.needsUpdate = true
  material.map = map // The viewer's material disposer owns this texture.
  const grain = triplanarTexture(
    texture(map),
    null,
    null,
    float(1 / finish.textureSize)
  ).r
  material.colorNode = uniform(material.color).mul(
    grain.mul(finish.textureStrength).add(1 - finish.textureStrength)
  )
  material.roughnessNode = grain
    .mul(finish.textureStrength)
    .add(1 - finish.textureStrength)
    .mul(finish.roughness)
    .clamp(0.04, 1)
  return material
}
