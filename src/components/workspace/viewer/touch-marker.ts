import * as THREE from "three"
import { exp, length, mix, mrt, uniform, uv, vec3, vec4 } from "three/tsl"
import { MeshBasicNodeMaterial } from "three/webgpu"
import type { Point3 } from "@/domain/nc/gcode"
import { millimetresPerPixel } from "./screen-scale"

/** The scene's output that glows: what a material writes there, the bed viewer blooms. */
export const GLOW = "glow"

/**
 * Diameter in CSS pixels of the square it is drawn on, seen face on; it keeps its size at every
 * zoom. The dot fades out well inside it, so no edge shows; the bloom draws its halo.
 */
const SIZE = 32

/** How far it is lifted off the surface along its normal, in millimetres. */
const LIFT = 0.05

/** How bright what it gives off is, which the bloom spreads: well above white. */
const GLOW_STRENGTH = 4

/** Its light: how far off the surface it shines from and how far it reaches (mm), how bright. */
const LIGHT = { lift: 4, reach: 50, intensity: 220 } as const

/**
 * A dot that gives off light: white-hot at its centre, fading into its colour with no edge, and
 * glowing far brighter than it shows, for the bloom to spread (`GLOW`).
 */
function dotMaterial(color: THREE.Color) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const r = length(uv().mul(2).sub(1))
  const dot = exp(r.div(0.3).pow(2).negate())
  const hot = exp(r.div(0.12).pow(2).negate())
  const tint = uniform(color)
  material.colorNode = mix(tint, vec3(1), hot.mul(0.85))
  material.opacityNode = dot
  material.mrtNode = mrt({
    [GLOW]: vec4(
      mix(tint, vec3(1), hot.mul(0.5)).mul(dot).mul(GLOW_STRENGTH),
      dot
    ),
  })
  return material
}

/**
 * What a probe moving from `origin` along `direction` meets first, in world coordinates: the
 * point and the surface's normal there, facing back along the move; null when it meets nothing.
 */
export type Collide = (
  origin: THREE.Vector3,
  direction: THREE.Vector3
) => { readonly point: THREE.Vector3; readonly normal: THREE.Vector3 } | null

const FACE = new THREE.Vector3(0, 0, 1)

/**
 * Where the probe touches next: a dot lying on the surface it touches, facing along its normal,
 * drawn over everything at a constant size, that lights what is around it. The group stays in
 * the scene, its light dark while the dot is hidden: a light that came and went would rebuild
 * every lit material's shader.
 */
export class TouchMarker {
  readonly object = new THREE.Group()
  private readonly dot: THREE.Mesh<THREE.PlaneGeometry, MeshBasicNodeMaterial>
  private readonly light: THREE.PointLight

  constructor(color: THREE.Color) {
    this.dot = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dotMaterial(color))
    this.dot.renderOrder = 11
    this.dot.frustumCulled = false
    this.dot.visible = false
    // Millimetres per CSS pixel where it is, so that it keeps its size on screen.
    this.dot.onBeforeRender = (renderer, _scene, camera) => {
      const perPixel = millimetresPerPixel(renderer, camera, this.dot)
      if (perPixel <= 0) return
      this.dot.scale.setScalar((perPixel * SIZE) / 2)
      this.dot.updateMatrixWorld()
    }
    this.light = new THREE.PointLight(color, 0, LIGHT.reach, 2)
    this.light.position.z = LIGHT.lift
    this.object.add(this.dot, this.light)
  }

  /**
   * Shows it at `position`, in the coordinates of the group it is in, lying on the surface
   * whose `normal` faces the way it came from; null hides it.
   */
  show(position: Point3 | null, normal: Point3 = [0, 0, 1]) {
    this.dot.visible = position !== null
    if (!position) {
      this.light.intensity = 0
      return
    }
    const facing = new THREE.Vector3(...normal).normalize()
    this.object.quaternion.setFromUnitVectors(FACE, facing)
    this.object.position.set(...position).addScaledVector(facing, LIFT)
    this.light.intensity = LIGHT.intensity
  }

  dispose() {
    this.object.removeFromParent()
    this.dot.geometry.dispose()
    this.dot.material.dispose()
    this.light.dispose()
  }
}
