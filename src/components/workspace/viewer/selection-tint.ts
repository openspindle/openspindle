import * as THREE from "three"
import { MeshStandardNodeMaterial } from "three/webgpu"

type SolidMaterial = THREE.MeshStandardMaterial | MeshStandardNodeMaterial

/** The viewer's solids: meshes in standard (PBR) materials, which its lights shade. */
const isSolid = (material: THREE.Material): material is SolidMaterial =>
  material instanceof THREE.MeshStandardMaterial ||
  material instanceof MeshStandardNodeMaterial

/**
 * A selected object drawn in the selection's colour: its solids' materials swapped for ones of
 * that colour, each as see-through as the one it stands in for, and swapped back when another
 * object, or none, is tinted. Lines and hidden helpers keep their own.
 */
export class SelectionTint {
  private readonly color: THREE.Color
  private readonly tinted = new Map<
    THREE.Mesh,
    THREE.Material | THREE.Material[]
  >()
  private materials: THREE.Material[] = []

  constructor(color: THREE.Color) {
    this.color = color
  }

  /** Tints the solids under `object`; null tints none. */
  apply(object: THREE.Object3D | null) {
    this.clear()
    object?.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const original = child.material as THREE.Material | THREE.Material[]
      const list = Array.isArray(original) ? original : [original]
      if (!list.length || !list.every(isSolid)) return
      const tints = list.map((material) => this.tint(material))
      this.tinted.set(child, original)
      child.material = Array.isArray(original) ? tints : tints[0]
    })
  }

  /** Restores every tinted solid's own materials. */
  clear() {
    for (const [mesh, original] of this.tinted) mesh.material = original
    this.tinted.clear()
    for (const material of this.materials) material.dispose()
    this.materials = []
  }

  dispose() {
    this.clear()
  }

  private tint(material: SolidMaterial) {
    // Keep node-based normal maps and texture coordinates when a stock is selected.
    const tint = material.clone()
    if (tint instanceof MeshStandardNodeMaterial) {
      tint.colorNode = null
      tint.roughnessNode = null
      tint.map = null
    }
    tint.color.copy(this.color)
    tint.metalness = 0.1
    tint.roughness = 0.6
    this.materials.push(tint)
    return tint
  }
}
