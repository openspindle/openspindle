import * as THREE from "three"
import { LineSegments2 } from "three/addons/lines/webgpu/LineSegments2.js"
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"
import {
  cameraProjectionMatrix,
  modelViewMatrix,
  normalLocal,
  positionLocal,
  transformNormalToView,
  vec4,
} from "three/tsl"
import { Line2NodeMaterial, MeshBasicNodeMaterial } from "three/webgpu"
import { materialsOf } from "@/lib/three-assets"

/**
 * How the viewer draws its solids: smoothly shaded, or toon shaded with their edges drawn, like a
 * CAD model's shaded view with visible edges.
 */
export type VisualStyle = "smooth" | "edges"

/**
 * What "edges" draws: its line colour, and how wide its creases and outlines are in the scene,
 * mm, so that they look thinner further off, as the solids do. An outline is drawn past the
 * silhouette, where a crease there reaches half its width.
 */
const EDGES = { color: 0x23282e, width: 0.3 } as const

/**
 * How far creases are drawn towards the eye, mm: off the faces they lie on, which would hide them
 * in part, and too little to move them on the screen.
 */
const CREASE_LIFT = 0.05

/** Faces meeting at more than this, in degrees, have their edge drawn. */
const CREASE_ANGLE = 30

/**
 * How much darker a toon copy of a metal is, at full metalness: toon shading has no reflections,
 * which make metal darker in the smooth style.
 */
const METAL_DARKENING = 0.8

/** The toon shades a face takes, from turned away from a light to facing it. */
const SHADES = [100, 160, 225] as const

type Materials = THREE.Material | THREE.Material[]

/** A solid as "edges" draws it: its own materials, their toon copies, and what is drawn over it. */
type Drawn = {
  original: Materials
  toon: Materials
  readonly outline: THREE.Mesh
  readonly edges: LineSegments2
}

/** The viewer's solids are what its lights shade: meshes in standard (PBR) materials. */
const isLit = (material: THREE.Material) =>
  material instanceof THREE.MeshStandardMaterial ||
  ("isMeshStandardNodeMaterial" in material &&
    material.isMeshStandardNodeMaterial === true)

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

/** Toon shades from `SHADES`, stepped. */
function shadesTexture() {
  const texture = new THREE.DataTexture(
    new Uint8Array(SHADES),
    SHADES.length,
    1,
    THREE.RedFormat
  )
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

/** A solid's outline: its back faces pushed out by `EDGES.width`, drawn behind it. */
function outlineMaterial() {
  const material = new MeshBasicNodeMaterial({
    color: EDGES.color,
    side: THREE.BackSide,
  })
  const view = modelViewMatrix.mul(vec4(positionLocal, 1))
  const out = transformNormalToView(normalLocal).mul(EDGES.width)
  material.vertexNode = cameraProjectionMatrix.mul(vec4(view.xyz.add(out), 1))
  return material
}

/** Copies what a solid's material shows into its toon copy, rebuilding it where that changes. */
function follow(toon: THREE.MeshToonMaterial, original: THREE.Material) {
  const lit = original as THREE.MeshStandardMaterial
  toon.color.copy(lit.color).multiplyScalar(1 - METAL_DARKENING * lit.metalness)
  toon.emissive.copy(lit.emissive)
  toon.opacity = lit.opacity
  toon.visible = lit.visible
  const rebuilt =
    toon.map !== lit.map ||
    toon.transparent !== lit.transparent ||
    toon.side !== lit.side ||
    toon.vertexColors !== lit.vertexColors ||
    toon.depthWrite !== lit.depthWrite ||
    toon.depthTest !== lit.depthTest
  if (rebuilt) {
    toon.map = lit.map
    toon.transparent = lit.transparent
    toon.side = lit.side
    toon.vertexColors = lit.vertexColors
    toon.depthWrite = lit.depthWrite
    toon.depthTest = lit.depthTest
    toon.needsUpdate = true
  }
}

/**
 * Draws a viewer's solids (its lit meshes: the bed, fixtures, stock and tools) in a visual style.
 * "smooth" leaves them as they are. "edges" shades each in toon copies of its materials and, where
 * it is opaque, draws its creases and its outline over it; they follow the solid, which keeps its
 * own materials meanwhile. `update` brings the scene to the style before each frame, so solids
 * added, moved, hidden or removed since are drawn as it has them.
 */
export class SolidStyle {
  /** The creases and outlines, which go in the scene. */
  readonly group = new THREE.Group()
  private style: VisualStyle = "smooth"
  private readonly drawn = new Map<THREE.Mesh, Drawn>()
  private readonly toons = new Map<THREE.Material, THREE.MeshToonMaterial>()
  private readonly shades = shadesTexture()
  /** Towards the eye by `CREASE_LIFT`, for this frame. */
  private readonly lift = new THREE.Matrix4()
  private readonly outline = outlineMaterial()
  private readonly crease = new Line2NodeMaterial({
    color: EDGES.color,
    linewidth: EDGES.width,
    worldUnits: true,
    // Lines this thin, covered in part by multisampling, would break up into dots.
    alphaToCoverage: false,
  })

  constructor() {
    this.group.name = "solid-style"
  }

  set(style: VisualStyle) {
    this.style = style
  }

  /** Before each frame: draws every solid in `scene` in the style, as `eye` sees them. */
  update(scene: THREE.Object3D, eye: THREE.Camera) {
    if (this.style === "smooth" && !this.drawn.size) return
    scene.updateMatrixWorld()
    eye.updateMatrixWorld()
    const forward = eye.getWorldDirection(new THREE.Vector3())
    this.lift.makeTranslation(forward.multiplyScalar(-CREASE_LIFT))
    const seen = new Set<THREE.Mesh>()
    const visit = (object: THREE.Object3D, shown: boolean) => {
      if (object === this.group) return
      const visible = shown && object.visible
      if (object instanceof THREE.Mesh && this.isSolid(object)) {
        seen.add(object)
        if (this.style === "edges") this.draw(object, visible)
        else this.forget(object)
      }
      for (const child of object.children) visit(child, visible)
    }
    visit(scene, true)
    for (const mesh of this.drawn.keys()) if (!seen.has(mesh)) this.forget(mesh)
    // Toon copies of materials no solid has any more.
    const used = new Set(
      [...this.drawn.values()].flatMap(({ original }) =>
        Array.isArray(original) ? original : [original]
      )
    )
    for (const [original, toon] of this.toons) {
      if (used.has(original)) continue
      toon.dispose()
      this.toons.delete(original)
    }
  }

  dispose() {
    for (const mesh of [...this.drawn.keys()]) this.forget(mesh)
    for (const toon of this.toons.values()) toon.dispose()
    this.toons.clear()
    this.shades.dispose()
    this.outline.dispose()
    this.crease.dispose()
    this.group.removeFromParent()
  }

  private isSolid(mesh: THREE.Mesh) {
    return this.drawn.has(mesh) || materialsOf(mesh).every(isLit)
  }

  private toonOf(original: THREE.Material) {
    let toon = this.toons.get(original)
    if (!toon) {
      toon = new THREE.MeshToonMaterial({ gradientMap: this.shades })
      this.toons.set(original, toon)
    }
    follow(toon, original)
    return toon
  }

  private draw(mesh: THREE.Mesh, visible: boolean) {
    let drawn = this.drawn.get(mesh)
    // A solid given other materials since keeps them as its own.
    if (drawn && mesh.material !== drawn.toon) drawn.original = mesh.material
    const original = drawn?.original ?? mesh.material
    const toon = Array.isArray(original)
      ? original.map((material) => this.toonOf(material))
      : this.toonOf(original)
    if (!drawn) {
      const outline = new THREE.Mesh(mesh.geometry, this.outline)
      const edges = new LineSegments2(
        new LineSegmentsGeometry().setPositions(creasesOf(mesh.geometry)),
        this.crease
      )
      for (const object of [outline, edges]) {
        object.matrixAutoUpdate = false
        this.group.add(object)
      }
      drawn = { original, toon, outline, edges }
      this.drawn.set(mesh, drawn)
    }
    // An array keeps its identity while its materials do, so that the check above holds.
    const kept = drawn.toon
    const same = Array.isArray(toon)
      ? Array.isArray(kept) &&
        kept.length === toon.length &&
        toon.every((material, index) => material === kept[index])
      : toon === kept
    if (!same) drawn.toon = toon
    mesh.material = drawn.toon
    const opaque = materialsOf({ material: original }).every(
      (material) =>
        material.visible && !material.transparent && material.opacity >= 1
    )
    drawn.outline.matrix.copy(mesh.matrixWorld)
    drawn.edges.matrix.multiplyMatrices(this.lift, mesh.matrixWorld)
    for (const object of [drawn.outline, drawn.edges]) {
      object.matrixWorldNeedsUpdate = true
      object.visible = visible && opaque
    }
    // The outline follows the solid's geometry, if it is given another.
    if (drawn.outline.geometry !== mesh.geometry) {
      drawn.outline.geometry = mesh.geometry
      drawn.edges.geometry.dispose()
      drawn.edges.geometry = new LineSegmentsGeometry().setPositions(
        creasesOf(mesh.geometry)
      )
    }
  }

  /** Gives a solid its own materials back, and stops drawing over it. */
  private forget(mesh: THREE.Mesh) {
    const drawn = this.drawn.get(mesh)
    if (!drawn) return
    if (mesh.material === drawn.toon) mesh.material = drawn.original
    drawn.outline.removeFromParent()
    drawn.edges.removeFromParent()
    drawn.edges.geometry.dispose()
    this.drawn.delete(mesh)
  }
}
