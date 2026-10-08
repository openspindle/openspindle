import * as THREE from "three"
import type { GCodeProgram, Point3 } from "@/domain/nc/gcode"
import type { ViewerGhost } from "@/components/workspace/viewer/viewer-input"
import type { LineRange } from "../bed-viewer-layout"
import { sameGhosts } from "./plate-identity"
import { SelectedLines, selectedLineMaterial } from "./selected-lines"
import type { SeeThroughLineMaterial } from "./see-through-line"
import {
  motionSegmentsBefore,
  segmentWindows,
  toolpathBuffers,
} from "./toolpath-buffers"

/** Faint enough to read as left out, and in another colour than any path, not just dimmer. */
const GHOST_OPACITY = 0.45

/** Under the program's own paths (3 and up), which stay readable over them. */
const GHOST_ORDER = 2

/** Selected, over the program's paths as their selection is (5). */
const SELECTED_ORDER = 6

/** LineSegments draw two vertices per program segment. */
const SEGMENT_VERTICES = 2

const MOTIONS = ["cut", "probe"] as const

/**
 * The vertex ranges of a program's cutting or probe moves: all of them, or those of `lines`.
 */
function vertexRanges(
  program: GCodeProgram,
  motion: (typeof MOTIONS)[number],
  lines: readonly LineRange[] | undefined
) {
  const buffers = toolpathBuffers(program)
  const vertices = buffers.vertices[motion]
  if (!lines)
    return vertices.length ? [{ start: 0, count: vertices.length / 3 }] : []
  return segmentWindows(program, lines).flatMap(({ first, last }) => {
    const start = motionSegmentsBefore(buffers, motion, first)
    const end = motionSegmentsBefore(buffers, motion, last)
    return end > start
      ? [
          {
            start: start * SEGMENT_VERTICES,
            count: (end - start) * SEGMENT_VERTICES,
          },
        ]
      : []
  })
}

/**
 * What a plate leaves out of its program, drawn faint at its work origin: the cutting and probe
 * moves of each ghost, or of its lines left out, and its selected lines wide in the selection's
 * colour, as selected paths are. Static: rebuilt only when the ghosts change.
 */
export class GhostView {
  readonly group = new THREE.Group()
  private readonly material: THREE.LineBasicMaterial
  private readonly selectedMaterial: SeeThroughLineMaterial
  private selected: SelectedLines[] = []
  private ghosts: readonly ViewerGhost[] = []

  constructor(color: THREE.Color, selected: THREE.Color) {
    this.material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthTest: false,
    })
    this.selectedMaterial = selectedLineMaterial(selected)
  }

  show(ghosts: readonly ViewerGhost[]) {
    if (sameGhosts(ghosts, this.ghosts)) return
    this.ghosts = ghosts
    this.clear()
    for (const ghost of ghosts) {
      this.draw(ghost.program, ghost.lines)
      if (ghost.selected?.length)
        this.drawSelected(ghost.program, ghost.selected)
    }
  }

  /** The cutting and probe moves of a program, or of its `lines`, faint. */
  private draw(program: GCodeProgram, lines: readonly LineRange[] | undefined) {
    const buffers = toolpathBuffers(program)
    for (const motion of MOTIONS) {
      const ranges = vertexRanges(program, motion, lines)
      if (!ranges.length) continue
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(buffers.vertices[motion], 3)
      )
      // A material array draws groups only: the ranges'.
      for (const { start, count } of ranges) geometry.addGroup(start, count, 0)
      const drawn = new THREE.LineSegments(geometry, [this.material])
      drawn.renderOrder = GHOST_ORDER
      this.group.add(drawn)
    }
  }

  /** The cutting and probe moves of a program's selected `lines`, wide. */
  private drawSelected(program: GCodeProgram, lines: readonly LineRange[]) {
    const buffers = toolpathBuffers(program)
    for (const motion of MOTIONS) {
      const ranges = vertexRanges(program, motion, lines)
      if (!ranges.length) continue
      const drawn = new SelectedLines(this.selectedMaterial, SELECTED_ORDER)
      drawn.set(buffers.vertices[motion], ranges)
      this.selected.push(drawn)
      this.group.add(drawn.object)
    }
  }

  /** Moves the ghosts to the plate's work origin without touching geometry. */
  place(origin: Point3) {
    this.group.position.set(...origin)
  }

  private clear() {
    for (const drawn of this.selected) drawn.dispose()
    this.selected = []
    for (const child of [...this.group.children]) {
      if (child instanceof THREE.LineSegments) child.geometry.dispose()
      this.group.remove(child)
    }
  }

  dispose() {
    this.clear()
    this.material.dispose()
    this.selectedMaterial.dispose()
  }
}
