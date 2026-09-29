import * as THREE from "three"
import { Line2 } from "three/addons/lines/Line2.js"
import { LineGeometry } from "three/addons/lines/LineGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import { LineSegments2 } from "three/addons/lines/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import type { Area, Path, Place, Point } from "@/domain/diagnostics"
import { disposeObjects } from "@/lib/three-assets"
import type { ViewerPalette } from "./palette"
import { sameProblems } from "./plate-identity"
import type { ViewerProblem } from "./viewer-input"

/** Lines in CSS pixels: a problem's, and the shown problem's. */
const LINE_WIDTH = 2
const SHOWN_LINE_WIDTH = 3.5
/**
 * A point's ring on the bed, in millimetres: hollow, unlike the filled dots of anchors and
 * probe touches. The shown one's is wider, on a faint disc.
 */
const RING = { inner: 0.9, outer: 1.5 } as const
const SHOWN_RING = { inner: 1.1, outer: 1.9 } as const
const SHOWN_DISC_RADIUS = 3
/** A flat area's fill, faint so that what lies under it stays readable. */
const FILL_OPACITY = 0.12
/** Over the setup markers and everything else. */
const RENDER_ORDER = 13

/** Drawn over everything, so transparent: the translucent stock drawn after it would tint it. */
const overlay = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  toneMapped: false,
} as const

function line(positions: number[], color: THREE.Color, width: number) {
  const object = new Line2(
    new LineGeometry().setPositions(positions),
    new LineMaterial({ color, linewidth: width, ...overlay })
  )
  object.renderOrder = RENDER_ORDER
  return object
}

function pointObjects({ at }: Point, color: THREE.Color, shown: boolean) {
  const flat = (geometry: THREE.BufferGeometry, opacity: number) => {
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        opacity,
        side: THREE.DoubleSide,
        ...overlay,
      })
    )
    mesh.position.set(...at)
    mesh.renderOrder = RENDER_ORDER
    return mesh
  }
  const { inner, outer } = shown ? SHOWN_RING : RING
  const ring = flat(new THREE.RingGeometry(inner, outer, 32), 1)
  if (!shown) return [ring]
  return [flat(new THREE.CircleGeometry(SHOWN_DISC_RADIUS, 32), 0.25), ring]
}

const pathObjects = ({ points }: Path, color: THREE.Color, width: number) =>
  points.length < 2 ? [] : [line(points.flat(), color, width)]

function areaObjects(
  { min, max }: Area,
  color: THREE.Color,
  width: number,
  shown: boolean
) {
  const size = max.map((value, axis) => Math.max(value - min[axis], 0.01))
  const center = min.map((value, axis) => (value + max[axis]) / 2)
  // A flat area is outlined and faintly filled; a box is drawn by its edges.
  if (Math.abs(max[2] - min[2]) < 1e-6) {
    const [x0, y0, z] = min
    const [x1, y1] = max
    const outline = line(
      [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z, x0, y0, z],
      color,
      width
    )
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(size[0], size[1]),
      new THREE.MeshBasicMaterial({
        color,
        opacity: shown ? FILL_OPACITY * 2 : FILL_OPACITY,
        side: THREE.DoubleSide,
        ...overlay,
      })
    )
    fill.position.set(center[0], center[1], z)
    fill.renderOrder = RENDER_ORDER
    return [fill, outline]
  }
  const box = new THREE.BoxGeometry(size[0], size[1], size[2])
  const edges = new THREE.EdgesGeometry(box)
  box.dispose()
  const object = new LineSegments2(
    new LineSegmentsGeometry().fromEdgesGeometry(edges),
    new LineMaterial({ color, linewidth: width, ...overlay })
  )
  edges.dispose()
  object.position.set(center[0], center[1], center[2])
  object.renderOrder = RENDER_ORDER
  return [object]
}

function placeObjects(
  place: Place,
  color: THREE.Color,
  shown: boolean
): THREE.Object3D[] {
  const width = shown ? SHOWN_LINE_WIDTH : LINE_WIDTH
  switch (place.kind) {
    case "point":
      return pointObjects(place, color, shown)
    case "path":
      return pathObjects(place, color, width)
    case "area":
      return areaObjects(place, color, width, shown)
  }
}

/**
 * A plate's problems where they are on its bed, over everything, in their severity's colour:
 * a ring at a point, a line along a path, a flat area's outline over a faint fill, and a box's
 * edges. The shown problem is drawn stronger; the viewer's markers name them.
 */
export class ProblemView {
  readonly group = new THREE.Group()
  private readonly palette: ViewerPalette
  private problems: readonly ViewerProblem[] = []
  private shown: string | null = null

  constructor(palette: ViewerPalette) {
    this.palette = palette
  }

  /** Draws the problems, `shown` by its key; unchanged problems are not drawn again. */
  show(problems: readonly ViewerProblem[], shown: string | null) {
    if (sameProblems(problems, this.problems) && shown === this.shown) return
    this.problems = problems
    this.shown = shown
    disposeObjects(this.group)
    this.group.clear()
    for (const problem of problems) {
      const color = this.palette.problem[problem.severity]
      const emphasized = problem.key === shown
      for (const place of problem.places) {
        const objects = placeObjects(place, color, emphasized)
        if (objects.length) this.group.add(...objects)
      }
    }
  }

  dispose() {
    disposeObjects(this.group)
    this.group.clear()
  }
}
