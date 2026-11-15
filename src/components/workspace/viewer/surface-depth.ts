import type { Material } from "three"

const PRIORITY = { fixture: 1, stock: 2, reference: 3 } as const

/** Resolve coplanar display surfaces in the depth buffer, never by moving geometry. */
export function surfaceDepth<T extends Material>(
  material: T,
  layer: keyof typeof PRIORITY
): T {
  const priority = PRIORITY[layer]
  material.polygonOffset = true
  material.polygonOffsetFactor = -priority
  material.polygonOffsetUnits = -priority
  return material
}
