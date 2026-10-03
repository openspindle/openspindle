import * as THREE from "three"
import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import { Line2NodeMaterial } from "three/webgpu"
import { materialsOf } from "@/lib/three-assets"

/**
 * How the viewer draws its solids: smoothly shaded, or shaded with their edges drawn, like a CAD
 * model's shaded view with visible edges.
 */
export type VisualStyle = "smooth" | "edges"

/**
 * What "edges" draws: its line colour and how much of it covers the solid under it, and how wide
 * its edges are: `millimetres` on the solids, so that they thin out as the view zooms out, but
 * on screen no narrower than `narrowest` and no wider than `widest`, CSS pixels, so that close
 * up they stay fine lines.
 */
const EDGES = {
  color: 0x23282e,
  opacity: 0.6,
  millimetres: 0.3,
  narrowest: 0.35,
  widest: 1,
} as const

/**
 * How far edges are drawn towards the eye, mm: off the faces they lie on, which would hide them
 * in part, and too little to move them on the screen.
 */
const EDGE_LIFT = 0.05

/** Faces meeting at more than this, in degrees, have their edge drawn. */
const CREASE_ANGLE = 30

/** The viewer's solids are what its lights shade: meshes in standard (PBR) materials. */
const isLit = (material: THREE.Material) =>
  material instanceof THREE.MeshStandardMaterial ||
  ("isMeshStandardNodeMaterial" in material &&
    material.isMeshStandardNodeMaterial === true)

/** Whether a solid hides what is behind it, so that its edges show as they are. */
const isOpaque = (mesh: THREE.Mesh) =>
  materialsOf(mesh).every(
    (material) =>
      material.visible && !material.transparent && material.opacity >= 1
  )

/** Where a geometry's faces crease, as line segments: worked out once per geometry. */
const creases = new WeakMap<THREE.BufferGeometry, Float32Array>()
function creasesOf(geometry: THREE.BufferGeometry) {
  let positions = creases.get(geometry)
  if (!positions) {
    const edges = new THREE.EdgesGeometry(geometry, CREASE_ANGLE)
    positions = new Float32Array(edges.getAttribute("position").array)
    edges.dispose()
    creases.set(geometry, positions)
  }
  return positions
}

/**
 * How wide edges are drawn where the view shows `millimetresPerPixel` (per CSS pixel; 0 while
 * it has no size), CSS pixels.
 */
export function edgeWidth(millimetresPerPixel: number) {
  if (!millimetresPerPixel) return EDGES.widest
  return THREE.MathUtils.clamp(
    EDGES.millimetres / millimetresPerPixel,
    EDGES.narrowest,
    EDGES.widest
  )
}

/**
 * The edges' material: blended over the solids they lie on with plain alpha blending. Not a
 * see-through fat line, which blends with a copy of the screen that every renderer in the window
 * shares.
 */
function edgeMaterial() {
  const material = new Line2NodeMaterial({
    color: EDGES.color,
    linewidth: EDGES.widest,
    opacity: EDGES.opacity,
    // Lines this thin, covered in part by multisampling, would break up into dots.
    alphaToCoverage: false,
  })
  material.blending = THREE.CustomBlending
  material.blendSrc = THREE.SrcAlphaFactor
  material.blendDst = THREE.OneMinusSrcAlphaFactor
  material.blendSrcAlpha = THREE.OneFactor
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  return material
}

/** The edges drawn over a solid, and the geometry they are of. */
type Drawn = {
  readonly edges: LineSegments2
  readonly geometry: THREE.BufferGeometry
}

/**
 * Draws a viewer's solids (its lit meshes: the bed, fixtures and tools) in a visual style.
 * "smooth" leaves them as they are; "edges" draws the edges where an opaque solid's faces
 * crease over it, in a group of their own, the solid keeping its own look. `update` brings the
 * scene to the style before each frame, so that solids added, moved, hidden or removed since are
 * drawn as it has them.
 */
export class SolidStyle {
  /** The edges, which go in the scene. */
  readonly group = new THREE.Group()
  private style: VisualStyle = "smooth"
  private readonly drawn = new Map<THREE.Mesh, Drawn>()
  /** Towards the eye by `EDGE_LIFT`, for this frame. */
  private readonly lift = new THREE.Matrix4()
  private readonly material = edgeMaterial()

  constructor() {
    this.group.name = "solid-style"
  }

  set(style: VisualStyle) {
    this.style = style
  }

  /** How wide the edges are drawn, CSS pixels (`edgeWidth`). */
  set lineWidth(width: number) {
    this.material.linewidth = width
  }

  /** Before each frame: draws every solid in `scene` in the style, as `eye` sees them. */
  update(scene: THREE.Object3D, eye: THREE.Camera) {
    if (this.style === "smooth" && !this.drawn.size) return
    scene.updateMatrixWorld()
    eye.updateMatrixWorld()
    const forward = eye.getWorldDirection(new THREE.Vector3())
    this.lift.makeTranslation(forward.multiplyScalar(-EDGE_LIFT))
    const seen = new Set<THREE.Mesh>()
    const visit = (object: THREE.Object3D, shown: boolean) => {
      if (object === this.group) return
      const visible = shown && object.visible
      if (object instanceof THREE.Mesh && materialsOf(object).every(isLit)) {
        seen.add(object)
        if (this.style === "edges") this.draw(object, visible)
      }
      for (const child of object.children) visit(child, visible)
    }
    visit(scene, true)
    for (const mesh of this.drawn.keys())
      if (this.style !== "edges" || !seen.has(mesh)) this.forget(mesh)
  }

  dispose() {
    for (const mesh of [...this.drawn.keys()]) this.forget(mesh)
    this.material.dispose()
    this.group.removeFromParent()
  }

  private draw(mesh: THREE.Mesh, visible: boolean) {
    let drawn = this.drawn.get(mesh)
    // A solid given another geometry has the edges of that one.
    if (drawn && drawn.geometry !== mesh.geometry) {
      this.forget(mesh)
      drawn = undefined
    }
    if (!drawn) {
      const edges = new LineSegments2(
        new LineSegmentsGeometry().setPositions(creasesOf(mesh.geometry)),
        this.material
      )
      edges.matrixAutoUpdate = false
      // After the solids, so that they blend over them.
      edges.renderOrder = 1
      this.group.add(edges)
      drawn = { edges, geometry: mesh.geometry }
      this.drawn.set(mesh, drawn)
    }
    const { edges } = drawn
    edges.matrix.multiplyMatrices(this.lift, mesh.matrixWorld)
    edges.matrixWorldNeedsUpdate = true
    edges.visible = visible && isOpaque(mesh)
  }

  /** Stops drawing a solid's edges. */
  private forget(mesh: THREE.Mesh) {
    const drawn = this.drawn.get(mesh)
    if (!drawn) return
    drawn.edges.removeFromParent()
    drawn.edges.geometry.dispose()
    this.drawn.delete(mesh)
  }
}
