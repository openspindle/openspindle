import type * as THREE from "three"
import { Line2NodeMaterial } from "three/webgpu"
import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import type { GCodeSegment, Point3 } from "@/domain/nc/gcode"
import type { Playhead } from "@/domain/nc/move-times"

/** How far ahead of the tool it reaches: the moves that start within this many seconds. */
const AHEAD_SECONDS = 4

/** The most moves it draws; a stretch of very short moves ends there. */
const MAX_PIECES = 2048

/** Its width in CSS pixels, and how much of its colour shows. */
const LOOK = { width: 2, opacity: 0.3 } as const

const point = ({ start, end }: GCodeSegment, fraction: number): Point3 => [
  start[0] + (end[0] - start[0]) * fraction,
  start[1] + (end[1] - start[1]) * fraction,
  start[2] + (end[2] - start[2]) * fraction,
]

/** How long a move takes at its feed, in seconds. */
const seconds = ({ start, end, feed }: GCodeSegment) =>
  (Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) * 60) /
  Math.max(feed, 1)

/**
 * Where the tool goes next, as a faint line over everything: from the tool to the end of the
 * move under way, then each whole move that starts within the next few seconds at their feeds.
 * Ending at a move's end, it changes only as the tool passes into the next move. Its buffers
 * are filled in place: lines rebuilt every frame would leave their GPU buffers behind.
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
      new Line2NodeMaterial({
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
   * Shows the moves `segments` makes from `playhead` on, from `from` (where the tool is drawn,
   * when it is) or else from where the playhead is along its move; a null playhead hides it.
   */
  show(
    segments: readonly GCodeSegment[],
    playhead: Playhead | null,
    from: Point3 | null
  ) {
    const first = playhead && segments.at(playhead.segment)
    if (!playhead || !first) {
      this.object.visible = false
      return
    }
    const starts = this.starts.array as Float32Array
    let start = from ?? point(first, playhead.fraction)
    // Until the move under way ends, then until each move after it ends.
    let elapsed = seconds(first) * (1 - playhead.fraction)
    let pieces = 0
    for (
      let index = playhead.segment;
      index < segments.length && pieces < MAX_PIECES;
      index++
    ) {
      const segment = segments[index]
      if (index > playhead.segment) {
        if (elapsed >= AHEAD_SECONDS) break
        elapsed += seconds(segment)
      }
      const { end } = segment
      if (end.some((value, axis) => value !== start[axis])) {
        starts.set([...start, ...end], pieces * 6)
        pieces++
      }
      start = end
    }
    this.object.geometry.instanceCount = pieces
    this.starts.needsUpdate = true
    this.object.visible = pieces > 0
  }

  dispose() {
    this.object.removeFromParent()
    this.object.geometry.dispose()
    this.object.material.dispose()
  }
}
