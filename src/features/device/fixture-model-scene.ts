import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { WORK_AXIS_LENGTH } from "@/components/workspace/bed-viewer-layout"
import { viewerPalette } from "@/components/workspace/viewer/palette"
import { workOriginAxes } from "@/components/workspace/viewer/plate-view"
import { CLICK_TOLERANCE } from "@/components/workspace/viewer/setup-arranger"
import { SetupMarkers } from "@/components/workspace/viewer/setup-markers"
import {
  GRID_COLORS,
  ViewerStage,
} from "@/components/workspace/viewer/viewer-stage"
import { toMicrometre } from "@/domain/primitives"
import type { FixtureBounds, FixtureModel } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import type { MountPoint } from "@/domain/fixtures/mount-points"
import type { SurfaceFinish } from "@/domain/materials/surface-material"
import { disposeObjects, inFixtureFrame } from "@/lib/three-assets"

/** What the preview shows: a fixture's model in its frame, in the fixture's finish, with its points. */
export type FixtureModelView = {
  readonly model: FixtureModel
  readonly points: readonly MountPoint[]
  readonly color: string
  /** How shiny it is, as on the plate (`definitionFinish`). */
  readonly finish: SurfaceFinish
}

export type FixtureModelSceneEvents = {
  /** The model was turned: onto a clicked face, or by a quarter turn. */
  orient: (orientation: Point3) => void
  /** The 3D view could not start: neither WebGPU nor WebGL 2 is available. */
  unavailable: () => void
}

/** A flat face of one of the model's meshes, drawn over in the primary colour. */
type Face = {
  readonly mesh: THREE.Mesh
  /** 1 for each of the mesh's triangles that lies on the face. */
  readonly triangles: Uint8Array
  readonly overlay: THREE.Mesh
}

/** The model is seen from the front, right and above, as it stands on the bed. */
const VIEW_DIRECTION = new THREE.Vector3(0.55, -1, 0.75).normalize()
const DOWN = new THREE.Vector3(0, 0, -1)
/** Clockwise seen from above. */
const QUARTER_TURN = new THREE.Quaternion().setFromAxisAngle(
  new THREE.Vector3(0, 0, 1),
  -Math.PI / 2
)
const FIELD_OF_VIEW = 30

/** Angles are kept to a thousandth of a degree, without float noise or −0. */
const thousandths = (value: number) => Number(value.toFixed(3)) + 0

const radians = (orientation: Point3 | undefined) =>
  (orientation ?? [0, 0, 0]).map((angle) =>
    THREE.MathUtils.degToRad(angle)
  ) as Point3

const quaternionOf = (orientation: Point3 | undefined) =>
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...radians(orientation), "XYZ")
  )

function anglesOf(quaternion: THREE.Quaternion): Point3 {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ")
  return [euler.x, euler.y, euler.z].map((angle) =>
    thousandths(THREE.MathUtils.radToDeg(angle))
  ) as Point3
}

const sameAngles = (a: Point3 | undefined, b: Point3 | undefined) =>
  radians(a).every((angle, axis) => angle === radians(b)[axis])

const sameBounds = (a: FixtureBounds, b: FixtureBounds) =>
  [0, 1, 2].every(
    (axis) => a.min[axis] === b.min[axis] && a.max[axis] === b.max[axis]
  )

/**
 * The triangles of a mesh on the flat face one of them is on: those whose corners all lie in
 * its plane, facing the same way. Thin slivers count too, whatever their rounded normals say.
 */
function faceOf(mesh: THREE.Mesh, triangle: number): Uint8Array {
  const geometry = mesh.geometry
  const position = geometry.getAttribute("position")
  const index = geometry.getIndex()
  const count = Math.floor((index ? index.count : position.count) / 3)
  const corner = (face: number, vertex: number) =>
    index ? index.getX(face * 3 + vertex) : face * 3 + vertex
  const [a, b, c] = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]
  const corners = (face: number) => {
    a.fromBufferAttribute(position, corner(face, 0))
    b.fromBufferAttribute(position, corner(face, 1))
    c.fromBufferAttribute(position, corner(face, 2))
  }
  corners(triangle)
  const normal = THREE.Triangle.getNormal(a, b, c, new THREE.Vector3())
  const constant = normal.dot(a)
  if (!geometry.boundingSphere) geometry.computeBoundingSphere()
  // A ten-thousandth of the mesh's radius, well above float noise and below any real step.
  const tolerance = Math.max(
    (geometry.boundingSphere?.radius ?? 1) * 1e-4,
    1e-9
  )
  const facing = new THREE.Vector3()
  const triangles = new Uint8Array(count)
  for (let face = 0; face < count; face++) {
    corners(face)
    if (
      Math.abs(normal.dot(a) - constant) > tolerance ||
      Math.abs(normal.dot(b) - constant) > tolerance ||
      Math.abs(normal.dot(c) - constant) > tolerance
    )
      continue
    if (THREE.Triangle.getNormal(a, b, c, facing).dot(normal) > 0)
      triangles[face] = 1
  }
  triangles[triangle] = 1
  return triangles
}

/** The face's triangles as a mesh of their own, in the mesh's space. */
function faceGeometry(mesh: THREE.Mesh, triangles: Uint8Array) {
  const position = mesh.geometry.getAttribute("position")
  const index = mesh.geometry.getIndex()
  let count = 0
  for (const flag of triangles) count += flag
  const positions = new Float32Array(count * 9)
  const vertex = new THREE.Vector3()
  let offset = 0
  triangles.forEach((flag, face) => {
    if (!flag) return
    for (let corner = 0; corner < 3; corner++) {
      const at = index ? index.getX(face * 3 + corner) : face * 3 + corner
      vertex.fromBufferAttribute(position, at).toArray(positions, offset)
      offset += 3
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  return geometry
}

/** Reference squares under the model: a tenth, a power of ten, of its size. */
function groundGrid({ min, max }: FixtureBounds) {
  const extent = Math.max(max[0] - min[0], max[1] - min[1], 1)
  const cell = 10 ** Math.floor(Math.log10(extent / 5))
  const divisions = Math.min(Math.ceil((extent * 1.6) / cell), 400)
  const grid = new THREE.GridHelper(divisions * cell, divisions, ...GRID_COLORS)
  grid.rotation.x = Math.PI / 2
  grid.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2])
  return grid
}

/**
 * The Three.js side of a fixture model's preview: the model as it stands in the fixture's frame
 * on the surface under it, its origin's axes and its mount points. Clicking a face turns the
 * model to stand on it. Frames render on demand, as in the bed viewer.
 */
export class FixtureModelScene {
  private readonly stage: ViewerStage
  private readonly events: FixtureModelSceneEvents
  private readonly camera = new THREE.PerspectiveCamera(
    FIELD_OF_VIEW,
    1,
    0.1,
    10000
  )
  private readonly controls: OrbitControls
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly material = new THREE.MeshStandardMaterial()
  private readonly faceMaterial: THREE.MeshBasicMaterial
  private readonly axes = workOriginAxes()
  private readonly markers: SetupMarkers
  private template: THREE.Object3D | null = null
  private view: FixtureModelView | null = null
  private content: THREE.Object3D | null = null
  private grid: THREE.GridHelper | null = null
  private face: Face | null = null
  /** What the camera was last fitted to. */
  private fitted: {
    readonly bounds: FixtureBounds
    readonly orientation: Point3 | undefined
  } | null = null
  private pointerStart: { x: number; y: number; id: number } | null = null

  /** Reports `events.unavailable` when neither WebGPU nor WebGL 2 is available. */
  static create(container: HTMLElement, events: FixtureModelSceneEvents) {
    return new FixtureModelScene(container, events)
  }

  private constructor(container: HTMLElement, events: FixtureModelSceneEvents) {
    this.events = events
    this.stage = new ViewerStage(container, this.frame, {
      unavailable: () => events.unavailable(),
      resize: (width, height) => {
        this.camera.aspect = width / height
        this.camera.updateProjectionMatrix()
      },
    })
    const palette = viewerPalette(container)
    this.faceMaterial = new THREE.MeshBasicMaterial({
      color: palette.primary,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    })
    const { renderer } = this.stage
    this.markers = new SetupMarkers(palette.primary)
    this.camera.up.set(0, 0, 1)
    this.controls = new OrbitControls(this.camera, renderer.domElement)
    this.controls.enableDamping = false
    this.controls.addEventListener("change", this.stage.invalidate)
    this.stage.scene.add(this.axes, this.markers.object)
    this.stage.resize()
    const canvas = renderer.domElement
    canvas.addEventListener("pointerdown", this.pointerDown)
    canvas.addEventListener("pointerup", this.pointerUp)
    canvas.addEventListener("pointercancel", this.pointerCancel)
    canvas.addEventListener("pointermove", this.pointerMove)
    canvas.addEventListener("pointerleave", this.pointerLeave)
  }

  /** The model's mesh in bed space, which the scene keeps and releases; null while it loads. */
  setMesh(template: THREE.Object3D | null) {
    const previous = this.template
    this.template = template
    this.rebuild()
    if (previous) disposeObjects(previous)
  }

  show(view: FixtureModelView) {
    this.view = view
    this.rebuild()
  }

  /** The mesh's box turned to `orientation`, before the frame's offset; null without a mesh. */
  turnedBounds(orientation: Point3): FixtureBounds | null {
    if (!this.template) return null
    const turned = new THREE.Group()
    turned.rotation.set(...radians(orientation))
    turned.add(this.template.clone(true))
    turned.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(turned, true)
    if (box.isEmpty()) return null
    return {
      min: box.min.toArray().map(toMicrometre) as Point3,
      max: box.max.toArray().map(toMicrometre) as Point3,
    }
  }

  /** Turns the model a quarter turn about Z, clockwise seen from above. */
  turn() {
    if (!this.view) return
    const turned = quaternionOf(this.view.model.orientation).premultiply(
      QUARTER_TURN
    )
    this.events.orient(anglesOf(turned))
  }

  dispose() {
    const canvas = this.stage.canvas
    canvas.removeEventListener("pointerdown", this.pointerDown)
    canvas.removeEventListener("pointerup", this.pointerUp)
    canvas.removeEventListener("pointercancel", this.pointerCancel)
    canvas.removeEventListener("pointermove", this.pointerMove)
    canvas.removeEventListener("pointerleave", this.pointerLeave)
    this.controls.dispose()
    this.clearFace()
    this.markers.dispose()
    // The drawn clone shares the template's geometry, released with it.
    if (this.content) this.stage.scene.remove(this.content)
    if (this.template) disposeObjects(this.template)
    this.material.dispose()
    this.faceMaterial.dispose()
    this.stage.dispose()
  }

  private rebuild() {
    this.clearFace()
    if (this.content) this.stage.scene.remove(this.content)
    this.content = null
    if (this.grid) {
      this.stage.scene.remove(this.grid)
      disposeObjects(this.grid)
      this.grid = null
    }
    const view = this.view
    if (!view) {
      this.markers.show(null)
      this.stage.invalidate()
      return
    }
    const { model } = view
    this.material.color.set(view.color)
    this.material.metalness = view.finish.metalness
    this.material.roughness = view.finish.roughness
    if (this.template) {
      const clone = this.template.clone(true)
      clone.traverse((child) => {
        if (child instanceof THREE.Mesh) child.material = this.material
      })
      this.content = inFixtureFrame(model, clone)
      this.stage.scene.add(this.content)
    }
    this.grid = groundGrid(model.bounds)
    this.stage.scene.add(this.grid)
    const { min, max } = model.bounds
    const size = Math.max(...max.map((value, axis) => value - min[axis]), 1)
    this.axes.scale.setScalar((size * 0.3) / WORK_AXIS_LENGTH)
    this.markers.show(
      view.points.map((point) => ({
        position: point.position,
        style: "target",
      }))
    )
    const fitted = this.fitted
    if (
      !fitted ||
      !sameBounds(fitted.bounds, model.bounds) ||
      !sameAngles(fitted.orientation, model.orientation)
    )
      this.fit(
        model.bounds,
        // A turned model is shown from the front again; a moved origin keeps the view.
        !!fitted && sameAngles(fitted.orientation, model.orientation)
      )
    this.fitted = { bounds: model.bounds, orientation: model.orientation }
    this.stage.invalidate()
  }

  /**
   * Frames the box with a margin, from the default direction or the one the view has: near
   * enough that every corner is in view.
   */
  private fit({ min, max }: FixtureBounds, keepDirection: boolean) {
    const low = new THREE.Vector3(...min)
    const high = new THREE.Vector3(...max)
    const center = low.clone().add(high).multiplyScalar(0.5)
    const direction = keepDirection
      ? this.camera.position.clone().sub(this.controls.target).normalize()
      : VIEW_DIRECTION
    const right = new THREE.Vector3().crossVectors(this.camera.up, direction)
    if (right.lengthSq() < 1e-9) right.set(1, 0, 0)
    right.normalize()
    const up = new THREE.Vector3().crossVectors(direction, right)
    // A tenth of the view stays free around the box.
    const tall = Math.tan(THREE.MathUtils.degToRad(FIELD_OF_VIEW) / 2) / 1.1
    const wide = tall * this.camera.aspect
    let distance = 1
    const corner = new THREE.Vector3()
    for (const x of [low.x, high.x])
      for (const y of [low.y, high.y])
        for (const z of [low.z, high.z]) {
          corner.set(x, y, z).sub(center)
          const depth = corner.dot(direction)
          distance = Math.max(
            distance,
            depth + Math.abs(corner.dot(right)) / wide,
            depth + Math.abs(corner.dot(up)) / tall
          )
        }
    this.controls.target.copy(center)
    this.camera.position.copy(center).addScaledVector(direction, distance)
    this.camera.near = distance / 100
    this.camera.far = distance * 100
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }

  private readonly frame = () => {
    this.stage.renderer.render(this.stage.scene, this.camera)
    return false
  }

  /** The model's triangle under the pointer, if any. */
  private hit(event: PointerEvent) {
    if (!this.content) return null
    const rect = this.stage.canvas.getBoundingClientRect()
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    )
    this.stage.scene.updateMatrixWorld(true)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObject(this.content, true).at(0)
    if (!hit || !(hit.object instanceof THREE.Mesh) || hit.faceIndex == null)
      return null
    return { mesh: hit.object, triangle: hit.faceIndex }
  }

  private clearFace() {
    if (!this.face) return
    this.face.overlay.removeFromParent()
    this.face.overlay.geometry.dispose()
    this.face = null
    this.stage.invalidate()
  }

  private hover(event: PointerEvent) {
    const hit = this.hit(event)
    this.stage.canvas.style.cursor = hit ? "pointer" : ""
    if (!hit) {
      this.clearFace()
      return
    }
    const { face } = this
    if (face?.mesh === hit.mesh && face.triangles[hit.triangle]) return
    this.clearFace()
    const triangles = faceOf(hit.mesh, hit.triangle)
    const overlay = new THREE.Mesh(
      faceGeometry(hit.mesh, triangles),
      this.faceMaterial
    )
    // The overlay is only drawn: picking finds the model's own triangles.
    overlay.raycast = () => {}
    overlay.renderOrder = 1
    hit.mesh.add(overlay)
    this.face = { mesh: hit.mesh, triangles, overlay }
    this.stage.invalidate()
  }

  /** Turns the model to stand on the clicked face: its outward normal points down. */
  private stand(event: PointerEvent) {
    const hit = this.hit(event)
    if (!hit || !this.view) return
    const { mesh, triangle } = hit
    const position = mesh.geometry.getAttribute("position")
    const index = mesh.geometry.getIndex()
    const [a, b, c] = [0, 1, 2].map((corner) =>
      new THREE.Vector3().fromBufferAttribute(
        position,
        index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner
      )
    )
    const normal = THREE.Triangle.getNormal(a, b, c, new THREE.Vector3())
    // As the frame has it: the mesh's own placement and the model's orientation applied.
    normal.applyNormalMatrix(
      new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
    )
    if (!normal.lengthSq()) return
    const turned = quaternionOf(this.view.model.orientation).premultiply(
      new THREE.Quaternion().setFromUnitVectors(normal, DOWN)
    )
    this.events.orient(anglesOf(turned))
  }

  private readonly pointerMove = (event: PointerEvent) => {
    // Orbiting moves the view, not the pointer over the model.
    if (event.buttons) return
    this.hover(event)
  }

  private readonly pointerLeave = () => {
    this.stage.canvas.style.cursor = ""
    this.clearFace()
  }

  private readonly pointerDown = (event: PointerEvent) => {
    this.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
    }
  }

  private readonly pointerUp = (event: PointerEvent) => {
    const start = this.pointerStart
    this.pointerStart = null
    // A press that travelled orbited the view; it was not a click.
    if (
      !start ||
      start.id !== event.pointerId ||
      event.button !== 0 ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >
        CLICK_TOLERANCE
    )
      return
    this.stand(event)
  }

  private readonly pointerCancel = () => {
    this.pointerStart = null
  }
}
