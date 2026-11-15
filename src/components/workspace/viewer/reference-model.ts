import * as THREE from "three"
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js"
import type { ReferenceModel } from "@/domain/models/reference"
import { materialFinish } from "./material-finish"
import { surfaceDepth } from "./surface-depth"

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
    const material = surfaceDepth(
      materialFinish("Reference overlay", new THREE.Color("#38bdf8"), {
        name: "Reference overlay",
        color: "#38bdf8",
        metalness: 0,
        roughness: 0.75,
        opacity: 0.45,
        texture: "none",
      }),
      "reference"
    )
    material.depthWrite = false
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = 2
    mesh.name = part.name
    group.add(mesh)
  }
  return [group]
}
