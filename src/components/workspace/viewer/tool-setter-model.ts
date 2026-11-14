import * as THREE from "three"
import type { Cylinder } from "@/domain/diagnostics"
import { SURFACE_FINISHES } from "@/domain/materials/surface-material"

/** A machined housing, dark seal and contact cap within the configured setter envelope. */
export function toolSetterModel(setter: Cylinder): THREE.Group {
  const group = new THREE.Group()
  group.name = "Fixed tool setter"
  group.position.set(...setter.center)
  const { metalness, roughness } = SURFACE_FINISHES.metal
  const housing = new THREE.MeshStandardMaterial({
    metalness,
    roughness,
    color: "#9ca5ad",
  })
  const seal = new THREE.MeshStandardMaterial({
    metalness: SURFACE_FINISHES.matte.metalness,
    roughness: SURFACE_FINISHES.matte.roughness,
    color: "#252a2e",
  })
  const contact = new THREE.MeshStandardMaterial({
    metalness,
    color: "#d9dfe3",
    roughness: 0.25,
  })
  const parts = [
    { radius: setter.radius, bottom: 0, height: 0.72, material: housing },
    {
      radius: setter.radius * 0.88,
      bottom: 0.72,
      height: 0.08,
      material: seal,
    },
    { radius: setter.radius, bottom: 0.8, height: 0.2, material: contact },
  ]
  for (const part of parts) {
    const height = setter.height * part.height
    const geometry = new THREE.CylinderGeometry(
      part.radius,
      part.radius,
      height,
      64
    )
    geometry.rotateX(Math.PI / 2)
    const mesh = new THREE.Mesh(geometry, part.material)
    mesh.position.z = setter.height * part.bottom + height / 2
    group.add(mesh)
  }
  return group
}
