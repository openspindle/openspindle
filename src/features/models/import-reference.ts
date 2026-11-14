import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { MODEL_LIMITS, modelFormatOf } from "@/domain/models/model"
import {
  ReferenceModelSchema,
  REFERENCE_TRIANGLES,
} from "@/domain/models/reference"
import type { ReferenceModel } from "@/domain/models/reference"
import { validateGlb } from "@/formats/models/glb"
import { disposeObjects, glbInBedSpace } from "@/lib/three-assets"

/** Preserve authored coordinates: STEP is mm/Z-up; GLB is metres/Y-up. */
export async function importReference(file: File): Promise<ReferenceModel> {
  if (file.size > MODEL_LIMITS.sourceBytes)
    throw new Error("The reference file exceeds 64 MB.")
  const format = modelFormatOf(file.name)
  if (!format) throw new Error("Choose a STEP or GLB reference model.")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const name = file.name.slice(0, 200)
  let parts: ReferenceModel["parts"]
  if (format === "step") {
    const { tessellateStep } = await import("./tessellation")
    const result = await tessellateStep(bytes, {})
    if (result.triangles > REFERENCE_TRIANGLES)
      throw new Error("Simplify the reference to at most 100,000 triangles.")
    parts = [
      {
        name,
        positions: Array.from(result.mesh.positions),
        indices: Array.from(result.mesh.indices),
      },
    ]
  } else {
    validateGlb(bytes, MODEL_LIMITS.sourceBytes)
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer, "")
    glbInBedSpace(gltf.scene)
    gltf.scene.updateMatrixWorld(true)
    parts = []
    let triangles = 0
    try {
      gltf.scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        const geometry = child.geometry as THREE.BufferGeometry
        const positions = geometry.getAttribute("position")
        const indices = geometry.index
          ? Array.from(geometry.index.array)
          : Array.from({ length: positions.count }, (_, i) => i)
        triangles += indices.length / 3
        if (triangles > REFERENCE_TRIANGLES || parts.length >= 32)
          throw new Error(
            "Simplify the reference to 100,000 triangles and 32 parts."
          )
        const point = new THREE.Vector3()
        const values: number[] = []
        for (let i = 0; i < positions.count; i++) {
          point
            .fromBufferAttribute(positions, i)
            .applyMatrix4(child.matrixWorld)
          values.push(point.x, point.y, point.z)
        }
        const material = Array.isArray(child.material)
          ? child.material[0]
          : child.material
        let appearance
        if (material instanceof THREE.MeshStandardMaterial)
          appearance = {
            name: material.name || "Imported GLB material",
            color: `#${material.color.getHexString()}`,
            metalness: material.metalness,
            roughness: Math.max(0.04, material.roughness),
            opacity: Math.max(0.05, material.opacity),
          }
        parts.push({
          name: (child.name || name).slice(0, 200),
          positions: values,
          indices,
          material: appearance,
        })
      })
    } finally {
      disposeObjects(gltf.scene)
    }
  }
  return ReferenceModelSchema.parse({
    name,
    units: "mm",
    frame: "work",
    parts,
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
  })
}
