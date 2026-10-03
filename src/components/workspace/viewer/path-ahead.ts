import type * as THREE from "three"
import { SeeThroughLineMaterial } from "./see-through-line"
import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import type { MoveIndex, Vec3 } from "@/domain/motion/spaces"
import type { MotionPlan } from "@/domain/motion/types"

/** The most moves it draws; a stretch of very short moves ends there. */
const MAX_PIECES = 2048

/** Its width in CSS pixels, and how much of its colour shows. */
const LOOK = { width: 2, opacity: 0.3 } as const

/**
 * Where the tool goes next, as a faint line over everything: from the tool to the end of the
 * move under way, then each whole move up to where the frame has it end (the moves that start
 * within the next few seconds). Ending at a move's end, it changes only as the tool passes into
 * the next move. Its buffers are filled in place: lines rebuilt every frame would leave their GPU
 * buffers behind.
 */
export class PathAhead {
  readonly object: LineSegments2
  private readonly starts: THREE.InstancedInterleavedBuffer

  constructor(color: THREE.Color) {
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(new Float32Array(MAX_PIECES * 6))
    this.starts = (
      geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute
    ).data as THREE.InstancedInterleavedBuffer
    geometry.instanceCount = 0
    this.object = new LineSegments2(
      geometry,
      new SeeThroughLineMaterial({
        color,
        linewidth: LOOK.width,
        transparent: true,
        opacity: LOOK.opacity,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    )
    this.object.renderOrder = 6
    this.object.frustumCulled = false
    this.object.visible = false
  }

  /**
   * Shows a plan's moves [move, aheadEnd) from `from`, where the tool is drawn: the rest of the
   * move under way, then each whole move after it. None to show hides it.
   */
  show(plan: MotionPlan, move: MoveIndex, aheadEnd: MoveIndex, from: Vec3) {
    const starts = this.starts.array as Float32Array
    const { to } = plan
    const last = Math.min(aheadEnd, plan.count, move + MAX_PIECES)
    const start = [...from]
    let pieces = 0
    for (let index: number = move; index < last; index++) {
      const end = to.subarray(index * 3, index * 3 + 3)
      if (end.some((value, axis) => value !== start[axis])) {
        starts.set(start, pieces * 6)
        starts.set(end, pieces * 6 + 3)
        pieces++
      }
      start.splice(0, 3, ...end)
    }
    this.object.geometry.instanceCount = pieces
    this.starts.needsUpdate = true
    this.object.visible = pieces > 0
  }

  /** Hides it. */
  hide() {
    this.object.visible = false
  }

  dispose() {
    this.object.removeFromParent()
    this.object.geometry.dispose()
    this.object.material.dispose()
  }
}
