import * as THREE from "three"
import {
  float,
  fwidth,
  instancedDynamicBufferAttribute,
  length,
  mix,
  smoothstep,
  uv,
  vec3,
} from "three/tsl"
import { PointsNodeMaterial } from "three/webgpu"
import type { Point3 } from "@/domain/nc/gcode"

/** How a point shows: on the item being moved, on something else, or a device anchor. */
export type MarkerStyle = "own" | "target" | "anchor"

export type Marker = {
  readonly position: Point3
  readonly style: MarkerStyle
  /** A ring around the point: picked, hovered or snapped to. */
  readonly ring?: boolean
}

/** Diameters in CSS pixels; markers keep their size at every zoom. */
const DOT_SIZE: Record<MarkerStyle, number> = { own: 11, target: 8, anchor: 10 }
const RING_SIZE = 22

/** One marker's attributes, a buffer of each, for `capacity` markers. */
type Buffers = {
  readonly capacity: number
  readonly positions: THREE.InstancedBufferAttribute
  readonly colors: THREE.InstancedBufferAttribute
  readonly sizes: THREE.InstancedBufferAttribute
  readonly rings: THREE.InstancedBufferAttribute
}

/**
 * Markers drawn as sprites, one per marker, at their size on screen: dots with a white rim, so
 * they read on the light metal bed and the dark MDF alike, and rings, white with a band of their
 * colour.
 */
function markerMaterial({ positions, colors, sizes, rings }: Buffers) {
  const material = new PointsNodeMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
  })
  material.positionNode = instancedDynamicBufferAttribute<"vec3">(
    positions,
    "vec3"
  )
  material.sizeNode = instancedDynamicBufferAttribute<"float">(sizes, "float")
  const color = instancedDynamicBufferAttribute<"vec3">(colors, "vec3")
  const ring = instancedDynamicBufferAttribute<"float">(
    rings,
    "float"
  ).greaterThan(0.5)
  const r = length(uv().mul(2).sub(1))
  const aa = fwidth(r)
  const edge = (at: number) => smoothstep(float(at).sub(aa), at, r)
  const disc = float(1).sub(edge(1))
  const band = edge(0.68).mul(float(1).sub(edge(0.88)))
  const white = vec3(1)
  material.colorNode = ring.select(
    mix(white, color, band),
    mix(color, white, edge(0.6))
  )
  material.opacityNode = ring.select(disc.mul(edge(0.6)), disc)
  return material
}

function buffers(capacity: number): Buffers {
  const attribute = (size: number) =>
    new THREE.InstancedBufferAttribute(
      new Float32Array(capacity * size),
      size
    ).setUsage(THREE.DynamicDrawUsage)
  return {
    capacity,
    positions: attribute(3),
    colors: attribute(3),
    sizes: attribute(1),
    rings: attribute(1),
  }
}

/** The mount points of a plate's setup items, drawn over everything while moving. */
export class SetupMarkers {
  readonly object: THREE.Sprite<THREE.Object3DEventMap>
  private readonly colors: Record<MarkerStyle, THREE.Color>
  private buffers = buffers(8)

  constructor(primary: THREE.Color) {
    this.colors = {
      own: primary,
      target: new THREE.Color(0x3d444d),
      anchor: new THREE.Color(0xf58b24),
    }
    this.object = new THREE.Sprite(markerMaterial(this.buffers))
    this.object.renderOrder = 12
    this.object.frustumCulled = false
    this.object.visible = false
  }

  /** Shows these markers; rings draw first, so their dots stay on top. */
  show(markers: readonly Marker[] | null) {
    if (!markers?.length) {
      this.object.visible = false
      return
    }
    const ordered = [
      ...markers.filter((marker) => marker.ring),
      ...markers.filter((marker) => !marker.ring),
    ]
    const { positions, colors, sizes, rings } = this.buffersFor(ordered.length)
    ordered.forEach((marker, index) => {
      const color = this.colors[marker.style]
      positions.setXYZ(index, ...marker.position)
      colors.setXYZ(index, color.r, color.g, color.b)
      sizes.setX(index, marker.ring ? RING_SIZE : DOT_SIZE[marker.style])
      rings.setX(index, marker.ring ? 1 : 0)
    })
    for (const changed of [positions, colors, sizes, rings])
      changed.needsUpdate = true
    this.object.count = ordered.length
    this.object.visible = true
  }

  /** Its material only: every sprite shares one geometry, which others still draw. */
  dispose() {
    this.object.removeFromParent()
    this.object.material.dispose()
  }

  /** Keeps the buffers while the markers fit; more get buffers twice as large. */
  private buffersFor(count: number) {
    if (count <= this.buffers.capacity) return this.buffers
    this.buffers = buffers(Math.max(count, this.buffers.capacity * 2))
    const previous = this.object.material
    this.object.material = markerMaterial(this.buffers)
    previous.dispose()
    return this.buffers
  }
}
