import * as THREE from "three"
import { Line2 } from "three/addons/lines/Line2.js"
import { LineGeometry } from "three/addons/lines/LineGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import type { Point3 } from "@/domain/primitives"
import { disposeObjects } from "@/lib/three-assets"

/** An edge drawn on a plate's bed while edges are picked: chosen, or under the pointer. */
export type EdgeHighlight = {
  readonly start: Point3
  readonly end: Point3
  readonly hovered: boolean
}

/** Lines in CSS pixels: a chosen edge's, and the one under the pointer's. */
const CHOSEN_WIDTH = 3
const HOVERED_WIDTH = 5
/** Over the setup markers, like problems. */
const RENDER_ORDER = 13

/** The edges a trace follows, and the one a click would add or remove, drawn over everything. */
export class EdgeHighlights {
  readonly group = new THREE.Group()
  private readonly color: THREE.Color

  constructor(color: THREE.Color) {
    this.color = color
  }

  /** Shows the edges; null or none hides them. */
  show(edges: readonly EdgeHighlight[] | null) {
    disposeObjects(this.group)
    this.group.clear()
    for (const { start, end, hovered } of edges ?? []) {
      const line = new Line2(
        new LineGeometry().setPositions([...start, ...end]),
        new LineMaterial({
          color: this.color,
          linewidth: hovered ? HOVERED_WIDTH : CHOSEN_WIDTH,
          opacity: hovered ? 1 : 0.8,
          // Drawn over everything, so transparent: the translucent stock drawn after it would tint it.
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        })
      )
      line.renderOrder = RENDER_ORDER
      this.group.add(line)
    }
  }

  dispose() {
    disposeObjects(this.group)
    this.group.clear()
  }
}
