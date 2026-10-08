import * as THREE from "three"

/** The viewer's solids: meshes in standard (PBR) materials, which its lights shade. */
const isSolid = (
  material: THREE.Material
): material is THREE.MeshStandardMaterial =>
  material instanceof THREE.MeshStandardMaterial

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

  private tint(material: THREE.MeshStandardMaterial) {
    const tint = new THREE.MeshStandardMaterial({
      color: this.color,
      metalness: 0.1,
      roughness: 0.6,
      transparent: material.transparent,
      opacity: material.opacity,
      depthWrite: material.depthWrite,
      side: material.side,
    })
    this.materials.push(tint)
    return tint
  }
}
