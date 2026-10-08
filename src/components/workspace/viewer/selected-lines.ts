import type * as THREE from "three"
import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import { SeeThroughLineMaterial } from "./see-through-line"

/** How wide selected paths are drawn, CSS pixels: wider than the paths around them. */
const SELECTED_WIDTH = 3

/** A selected path's line: wide, and drawn over everything as the paths are. */
export function selectedLineMaterial(color: THREE.Color) {
  return new SeeThroughLineMaterial({
    color,
    linewidth: SELECTED_WIDTH,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
}

/** A vertex range of line segments' vertices, two per segment. */
export type VertexRange = { readonly start: number; readonly count: number }

/**
 * Selected segments of a path drawn wide (a fat line, which plain lines cannot be), and how many
 * of them show: those that start before a vertex, as playback reveals the path.
 */
export class SelectedLines {
  readonly object: LineSegments2
  /** The first vertex of each segment drawn, in order. */
  private starts: number[] = []

  constructor(material: SeeThroughLineMaterial, renderOrder: number) {
    this.object = new LineSegments2(new LineSegmentsGeometry(), material)
    this.object.renderOrder = renderOrder
    this.object.frustumCulled = false
    this.object.visible = false
  }

  /** Draws the segments of `vertices` (x, y, z each) in `ranges`, which are in order. */
  set(vertices: Float32Array, ranges: readonly VertexRange[]) {
    const total = ranges.reduce((sum, { count }) => sum + count, 0)
    const positions = new Float32Array(total * 3)
    const starts: number[] = []
    let at = 0
    for (const { start, count } of ranges) {
      positions.set(vertices.subarray(start * 3, (start + count) * 3), at * 3)
      for (let vertex = start; vertex < start + count; vertex += 2)
        starts.push(vertex)
      at += count
    }
    this.starts = starts
    this.object.geometry.dispose()
    this.object.geometry = new LineSegmentsGeometry()
    if (total) this.object.geometry.setPositions(positions)
    this.show(Infinity)
  }

  /** Shows the segments that start before vertex `end`; returns whether any does. */
  show(end: number) {
    let low = 0
    let high = this.starts.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.starts[middle] < end) low = middle + 1
      else high = middle
    }
    this.object.geometry.instanceCount = low
    this.object.visible = low > 0
    return low > 0
  }

  dispose() {
    this.object.geometry.dispose()
    this.object.removeFromParent()
  }
}
