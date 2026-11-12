import * as THREE from "three"
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js"
import type { ReferenceModel } from "@/domain/models/reference"
import { materialFinish } from "./material-finish"

/** Reference placement is relative to work zero and never alters the machining program. */
export function referenceObjects(model: ReferenceModel | null | undefined) {
  if (!model) return []
  const group = new THREE.Group()
  group.position.set(...model.offset)
  group.rotation.set(
    ...(model.rotation.map((v) => THREE.MathUtils.degToRad(v)) as [
      number,
      number,
      number,
    ])
  )
  group.scale.setScalar(model.scale)
  for (const part of model.parts) {
    const source = new THREE.BufferGeometry()
    source.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(part.positions, 3)
    )
    source.setIndex(part.indices)
    const geometry = toCreasedNormals(source, Math.PI / 4)
    source.dispose()
    const material = materialFinish(
      part.material?.name ?? "Unspecified material",
      new THREE.Color("#aab3bb"),
      part.material
    )
    material.transparent = true
    material.opacity = Math.min(material.opacity, 0.32)
    material.depthWrite = false
    material.polygonOffset = true
    material.polygonOffsetFactor = -1
    material.polygonOffsetUnits = -1
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = part.name
    group.add(mesh)
  }
  return [group]
}
