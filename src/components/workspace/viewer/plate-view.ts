import * as THREE from "three"
import { Line2 } from "three/addons/lines/Line2.js"
import { LineGeometry } from "three/addons/lines/LineGeometry.js"
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
import { fixtureModelFinish } from "@/domain/fixtures/catalog"
import type { MachineBed } from "@/domain/fixtures/machine-bed"
import { setupItemKey } from "@/domain/plate/setup-items"
import type { SetupItemRef } from "@/domain/plate/setup-items"
import { isMatteKind } from "@/domain/fixtures/definitions"
import type {
  FixtureInstance,
  FixtureModel,
} from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import {
  disposeMaterials,
  disposeObjects,
  inFixtureFrame,
} from "@/lib/three-assets"
import type { Stock } from "@/domain/stock/stock"
import type {
  ViewerPlate,
  ViewerProblem,
} from "@/components/workspace/viewer/viewer-input"
import {
  ANCHOR_DISPLAY_LIFT,
  STORED_ANCHOR_RADIUS,
  WORK_AXIS_LABEL_DISTANCE,
  WORK_AXIS_LABEL_SIZE,
  WORK_AXIS_LENGTH,
  bedArea,
  plateAnchorPoints,
  plateKit,
  plateStockBounds,
} from "../bed-viewer-layout"
import type { PlatePlacement, ViewerBounds } from "../bed-viewer-layout"
import type { ViewerPalette } from "./palette"
import { PlatePath } from "./plate-path"
import type { PathPresentation } from "./plate-path"
import {
  sameFields,
  samePlate,
  sameProblems,
  sameRanges,
} from "./plate-identity"
import type { FieldEquality } from "./plate-identity"
import { ProblemView } from "./problem-view"
import { SetupMarkers } from "./setup-markers"
import type { Marker } from "./setup-markers"
import { GRID_COLORS } from "./viewer-stage"
import type { ViewerAssets } from "./viewer-assets"

export type PlatePresentation = PathPresentation & {
  showStock: boolean
  /** The plate's problems with a place on its bed, and the key of the one shown. */
  problems: readonly ViewerProblem[]
  shownProblem: string | null
  /** Where the connected machine keeps work zero, on this plate's bed; null to leave it out. */
  machineOrigin: Point3 | null
}

/** A setup item under the pointer: which, how far along the ray, and where it was hit. */
export type ItemHit = {
  readonly item: SetupItemRef
  readonly distance: number
  readonly point: THREE.Vector3
}

/** Where an item's box is drawn: its box in its own frame, and that frame on the bed. */
type ItemFrame = {
  readonly position: Point3
  readonly rotation: Point3
  readonly box: ViewerBounds
}

const ZERO: Point3 = [0, 0, 0]
/** A design that cuts nothing is outlined by a small box around its work origin. */
const BARE_ORIGIN: ViewerBounds = { min: [-2, -2, -2], max: [2, 2, 2] }
/** The work origin's axis lines, in CSS pixels. */
const WORK_AXIS_LINE_WIDTH = 1.5
/** A device anchor's solid dot; its border reaches out to STORED_ANCHOR_RADIUS. */
const ANCHOR_DOT_RADIUS = 1.2
const MACHINE_ORIGIN_RADIUS = 2.2

const plus = (point: Point3, delta: Point3): Point3 => [
  point[0] + delta[0],
  point[1] + delta[1],
  point[2] + delta[2],
]

/** The setup item an object belongs to: the nearest ancestor tagged with one. */
function itemOf(object: THREE.Object3D | null): SetupItemRef | null {
  for (let node = object; node; node = node.parent) {
    const item: unknown = node.userData.setupItem
    if (item) return item as SetupItemRef
  }
  return null
}

/** An item's box outline, drawn over everything in the viewer's primary color. */
function boxOutline(
  { position, rotation, box }: ItemFrame,
  color: THREE.Color
) {
  const size = box.max.map((value, axis) =>
    Math.max(value - box.min[axis], 0.1)
  ) as Point3
  const shape = new THREE.BoxGeometry(...size)
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(shape),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    })
  )
  shape.dispose()
  edges.position.set(...boundsCenter(box))
  edges.renderOrder = 7
  const frame = new THREE.Group()
  frame.position.set(...position)
  frame.rotation.set(
    ...(rotation.map((angle) => THREE.MathUtils.degToRad(angle)) as Point3)
  )
  frame.add(edges)
  return frame
}

const PRESENTATION_EQUALITY: FieldEquality<PlatePresentation> = {
  active: Object.is,
  showStock: Object.is,
  showRapids: Object.is,
  ranges: sameRanges,
  hidden: sameRanges,
  progress: Object.is,
  previewLine: Object.is,
  previewProbePoint: Object.is,
  playhead: (a, b) =>
    a === b ||
    (!!a && !!b && a.segment === b.segment && a.fraction === b.fraction),
  problems: sameProblems,
  shownProblem: Object.is,
  machineOrigin: (a, b) =>
    a === b || (!!a && !!b && a.every((value, index) => value === b[index])),
  liveTool: (a, b) =>
    a === b ||
    (!!a &&
      !!b &&
      a.tool === b.tool &&
      a.position.every((value, index) => value === b.position[index])),
}

/** Scene services a plate keeps using after construction. */
export type PlateViewContext = {
  palette: ViewerPalette
  assets: ViewerAssets
  /** Requests a frame after an asynchronous change, such as a fixture load. */
  invalidate: () => void
  /** The renderer's device pixel ratio, for markers sized in CSS pixels. */
  pixelRatio: number
}

function boundsCenter({ min, max }: ViewerBounds): Point3 {
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
}

function replaceChildren(group: THREE.Group, children: THREE.Object3D[]) {
  disposeObjects(group)
  group.clear()
  if (children.length) group.add(...children)
}

/** The reference grid below a bed, in 10 mm squares. */
export function bedGrid(bed: MachineBed) {
  const { min, max } = bedArea(bed)
  const size = Math.max(max[0] - min[0], max[1] - min[1])
  const grid = new THREE.GridHelper(size, Math.round(size / 10), ...GRID_COLORS)
  grid.rotation.x = Math.PI / 2
  grid.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2])
  return grid
}

/** Labels stay at the plate's physical work origin, independent of playback. */
export function workOriginAxes() {
  const group = new THREE.Group()
  const colors = ["#b83832", "#287a36", "#285fc1"]
  for (const [axis, letter] of ["X", "Y", "Z"].entries()) {
    const end: Point3 = [0, 0, 0]
    end[axis] = WORK_AXIS_LENGTH
    const line = new Line2(
      new LineGeometry().setPositions([0, 0, 0, ...end]),
      new LineMaterial({
        color: colors[axis],
        linewidth: WORK_AXIS_LINE_WIDTH,
        // Drawn over everything, so transparent: the translucent stock drawn after an opaque
        // overlay would tint it.
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    )
    line.renderOrder = 8
    group.add(line)
    const canvas = document.createElement("canvas")
    canvas.width = canvas.height = 64
    const context = canvas.getContext("2d")
    if (!context) continue
    context.font = "600 44px system-ui, sans-serif"
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillStyle = colors[axis]
    context.fillText(letter, 32, 34)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        // Drawn over everything, so transparent: the translucent stock drawn after an opaque
        // overlay would tint it.
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    )
    label.position.setComponent(axis, WORK_AXIS_LABEL_DISTANCE)
    label.scale.set(WORK_AXIS_LABEL_SIZE, WORK_AXIS_LABEL_SIZE, 1)
    label.renderOrder = 9
    group.add(label)
  }
  return group
}

/** A selected plate's outline, just outside its bed. */
function selectionOutline(color: THREE.Color, { bounds }: MachineBed) {
  const [left, front] = bounds.min.map((value) => value - 3)
  const [right, back, top] = bounds.max.map((value, axis) =>
    axis === 2 ? value + 0.3 : value + 3
  )
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(left, front, top),
      new THREE.Vector3(right, front, top),
      new THREE.Vector3(right, back, top),
      new THREE.Vector3(left, back, top),
    ]),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    })
  )
  outline.renderOrder = 4
  return outline
}

/**
 * PCB stock is copper-clad FR-4: its colour is the copper on top, and the laminate shows at
 * its sides and underneath.
 */
const PCB_LAMINATE = "#cfc68f"

/** The colour of a stock's top face, and of the rest of its block. */
function stockColors({ material, color }: Stock) {
  const top = new THREE.Color(color)
  return {
    top,
    body: material === "PCB" ? new THREE.Color(PCB_LAMINATE) : top,
  }
}

/** The block's edges, darker than its faces: those around the top face in its colour. */
function stockEdges(
  geometry: THREE.BufferGeometry,
  top: THREE.Color,
  body: THREE.Color
) {
  const edges = new THREE.EdgesGeometry(geometry)
  const position = edges.getAttribute("position")
  const colors = new Float32Array(position.count * 3)
  const [topEdge, bodyEdge] = [top, body].map((color) =>
    color.clone().multiplyScalar(0.6)
  )
  // Each edge is a pair of vertices; the block is centred, so the top face's lie above zero.
  for (let index = 0; index < position.count; index += 2) {
    const color =
      position.getZ(index) > 0 && position.getZ(index + 1) > 0
        ? topEdge
        : bodyEdge
    color.toArray(colors, index * 3)
    color.toArray(colors, index * 3 + 3)
  }
  edges.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  return edges
}

function stockObjects(plate: ViewerPlate): THREE.Object3D[] {
  const { stock } = plate
  const bounds = plateStockBounds(plate)
  if (!stock || !bounds) return []
  const { top, body } = stockColors(stock)
  const surface = (color: THREE.Color) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
    })
  const sides = surface(body)
  const geometry = new THREE.BoxGeometry(stock.width, stock.depth, stock.height)
  // A box's faces are +X, −X, +Y, −Y, +Z and −Z: the stock's top is the fifth.
  const block = new THREE.Mesh(geometry, [
    sides,
    sides,
    sides,
    sides,
    surface(top),
    sides,
  ])
  block.position.set(...boundsCenter(bounds))
  const edges = new THREE.LineSegments(
    stockEdges(geometry, top, body),
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
    })
  )
  edges.position.copy(block.position)
  return [block, edges]
}

/** The machine's work zero: a dot in a half-opaque shell, seen through the stock and fixtures. */
function machineOriginMarker(color: THREE.Color) {
  const layer = (radius: number, opacity: number, renderOrder: number) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 24, 16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    )
    mesh.renderOrder = renderOrder
    return mesh
  }
  const marker = new THREE.Group()
  marker.add(
    layer(MACHINE_ORIGIN_RADIUS, 0.5, 12),
    layer(ANCHOR_DOT_RADIUS, 1, 13)
  )
  marker.visible = false
  return marker
}

/**
 * Orange device anchors: a dot in a half-opaque border of its color. Each marker disc spans
 * the border too and carries its hover title.
 */
function anchorMarkers(plate: ViewerPlate) {
  const anchors = plateAnchorPoints(plate)
  if (!anchors.length) return []
  const disc = new THREE.CircleGeometry(STORED_ANCHOR_RADIUS, 28)
  const center = new THREE.CircleGeometry(ANCHOR_DOT_RADIUS, 28)
  const overlay = (opacity: number) =>
    new THREE.MeshBasicMaterial({
      color: 0xf58b24,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
  const border = overlay(0.5)
  const fill = overlay(1)
  return anchors.map((anchor) => {
    const marker = new THREE.Mesh(disc, border)
    marker.position.set(
      anchor.point[0],
      anchor.point[1],
      anchor.point[2] + ANCHOR_DISPLAY_LIFT
    )
    marker.renderOrder = 10
    marker.userData.anchorTitle = `${anchor.name} · X ${Number(anchor.position[0].toFixed(3))}, Y ${Number(anchor.position[1].toFixed(3))} mm`
    const dot = new THREE.Mesh(center, fill)
    dot.position.copy(marker.position)
    dot.renderOrder = 11
    return { marker, dot }
  })
}

/** A fixture's content, rotated and placed as its instance says. */
function placedFixture(instance: FixtureInstance, content: THREE.Object3D) {
  const placement = new THREE.Group()
  placement.position.set(...instance.position)
  const [x, y, z] = instance.rotation
  placement.rotation.set(
    THREE.MathUtils.degToRad(x),
    THREE.MathUtils.degToRad(y),
    THREE.MathUtils.degToRad(z)
  )
  placement.add(content)
  return placement
}

/** Fixture clones share the template's geometry; each instance owns its material. */
function fixtureMesh(
  model: FixtureModel,
  template: THREE.Object3D,
  material: THREE.Material
) {
  const clone = template.clone(true)
  clone.traverse((child) => {
    if (child instanceof THREE.Mesh) child.material = material
  })
  return inFixtureFrame(model, clone)
}

/**
 * A fixture's box: what a box fixture draws, and what stands in for a library model missing
 * from this library, which keeps the setup readable.
 */
function fixtureBox(model: FixtureModel, material: THREE.Material) {
  const { min, max } = model.bounds
  const size = max.map((value, axis) =>
    Math.max(value - min[axis], 0.1)
  ) as Point3
  const box = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  box.position.set(
    ...(min.map((value, axis) => value + size[axis] / 2) as Point3)
  )
  return box
}

/**
 * One plate's scene graph. Updates rebuild only what changed: the uploaded
 * toolpath and loaded fixtures survive edits that do not affect them.
 */
export class PlateView {
  readonly root = new THREE.Group()
  /** Invisible box around the placed plate, for click selection. */
  readonly pick: THREE.Mesh
  /** The bed it is drawn on: that of its plate's machine when it was made. */
  readonly machineBed: MachineBed
  private current: ViewerPlate
  private presentation: PlatePresentation
  private readonly context: PlateViewContext
  private readonly bed = new THREE.Group()
  private readonly fixtures = new THREE.Group()
  private fixtureMaterials: THREE.Material[] = []
  /** Placeholder boxes are this view's own; model clones share their templates' geometry. */
  private fixtureGeometries: THREE.BufferGeometry[] = []
  /** Pending fixture loads apply only to the fixture list that started them. */
  private fixtureGeneration = 0
  private readonly stock = new THREE.Group()
  private readonly path: PlatePath
  private readonly decoration = new THREE.Group()
  private readonly axes = workOriginAxes()
  private readonly anchors = new THREE.Group()
  private anchorDiscs: THREE.Mesh[] = []
  private readonly selection: THREE.LineLoop<
    THREE.BufferGeometry,
    THREE.LineBasicMaterial
  >
  /** Each drawn fixture's placed group, by instance id. */
  private readonly fixtureGroups = new Map<string, THREE.Group>()
  /** The selected item's box outline. */
  private readonly outline = new THREE.Group()
  private readonly markers: SetupMarkers
  private readonly problems: ProblemView
  private readonly machineOrigin: THREE.Group
  private selectedItem: SetupItemRef | null = null
  /** An item drawn moved by a delta, while it is dragged or until its move arrives. */
  private preview: { item: SetupItemRef; delta: Point3 } | null = null

  constructor(
    plate: ViewerPlate,
    placement: PlatePlacement,
    presentation: PlatePresentation,
    context: PlateViewContext
  ) {
    this.current = plate
    this.presentation = presentation
    this.context = context
    this.root.userData.plateId = plate.id
    const machineBed = plateKit(plate).bed
    this.machineBed = machineBed
    this.bed.add(context.assets.bed(machineBed).clone(true))
    this.bed.userData.setupItem = { kind: "bed" } satisfies SetupItemRef
    this.stock.userData.setupItem = { kind: "stock" } satisfies SetupItemRef
    this.path = new PlatePath(plate, context.palette, {
      load: (url) => context.assets.toolModel(url),
      invalidate: context.invalidate,
    })
    this.selection = selectionOutline(context.palette.primary, machineBed)
    this.markers = new SetupMarkers(context.palette.primary, context.pixelRatio)
    this.problems = new ProblemView(context.palette)
    this.machineOrigin = machineOriginMarker(context.palette.primary)
    this.decoration.add(
      this.axes,
      this.anchors,
      bedGrid(machineBed),
      this.selection
    )
    this.pick = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial({ visible: false })
    )
    this.pick.userData.plateId = plate.id
    this.root.add(
      this.bed,
      this.fixtures,
      this.stock,
      this.path.group,
      this.decoration,
      this.outline,
      this.markers.object,
      this.problems.group,
      this.machineOrigin,
      this.pick
    )
    this.buildSetup(plate)
    this.loadFixtures(plate)
    this.place(placement)
    this.applyPresentation()
  }

  get plate() {
    return this.current
  }

  /** Anchor discs, for hover titles. */
  get anchorPicks(): readonly THREE.Mesh[] {
    return this.anchorDiscs
  }

  /** Repositions the plate and rebuilds only the parts whose inputs changed. */
  update(plate: ViewerPlate, placement: PlatePlacement) {
    this.place(placement)
    const previous = this.current
    if (plate === previous) return
    this.current = plate
    // A move shown ahead of its arrival is now part of the plate.
    this.preview = null
    this.buildSetup(plate)
    if (!samePlate(previous, plate, ["fixtures"])) this.loadFixtures(plate)
    this.path.update(plate)
    this.applyPresentation()
    this.renderOutline()
    this.applyPreview()
  }

  /** The nearest setup item the picking ray hits: the bed, a fixture or the stock. */
  itemHit(raycaster: THREE.Raycaster): ItemHit | null {
    const candidates: THREE.Object3D[] = [
      ...this.fixtureGroups.values(),
      this.bed,
    ]
    if (this.stock.visible && this.stock.children.length)
      candidates.push(this.stock)
    for (const hit of raycaster.intersectObjects(candidates, true)) {
      const item = itemOf(hit.object)
      if (item) return { item, distance: hit.distance, point: hit.point }
    }
    return null
  }

  /** Outlines the selected item's box; null clears it. */
  select(item: SetupItemRef | null) {
    const key = item && setupItemKey(item)
    if (key === (this.selectedItem && setupItemKey(this.selectedItem))) return
    this.selectedItem = item
    this.renderOutline()
    this.applyPreview()
  }

  /** Shows mount point markers; null hides them. */
  showMarkers(markers: readonly Marker[] | null) {
    this.markers.show(markers)
  }

  /**
   * Draws an item moved by `delta` without changing the plate: the stock carries the design,
   * as its move does. Null draws it where the plate has it.
   */
  setPreview(item: SetupItemRef, delta: Point3 | null) {
    this.preview = delta ? { item, delta } : null
    this.applyPreview()
  }

  /** Applies selection, visibility and playback; returns whether anything changed. */
  present(presentation: PlatePresentation) {
    if (sameFields(PRESENTATION_EQUALITY, this.presentation, presentation))
      return false
    this.presentation = presentation
    this.applyPresentation()
    return true
  }

  /** Swaps in a loaded model of its bed; clones share the template's resources. */
  setBed(machineBed: MachineBed, template: THREE.Object3D) {
    if (machineBed !== this.machineBed) return
    this.bed.clear()
    this.bed.add(template.clone(true))
  }

  dispose() {
    this.fixtureGeneration++
    this.root.removeFromParent()
    this.path.dispose()
    this.markers.dispose()
    this.problems.dispose()
    // Bed and fixture clones share their templates' geometry; release only owned resources.
    disposeObjects(
      this.stock,
      this.decoration,
      this.outline,
      this.machineOrigin,
      this.pick
    )
    disposeMaterials(this.fixtureMaterials)
    for (const geometry of this.fixtureGeometries) geometry.dispose()
    this.root.clear()
  }

  private place({ bounds, offsetX }: PlatePlacement) {
    this.root.position.x = offsetX
    const center = boundsCenter(bounds)
    const size = (axis: 0 | 1 | 2) =>
      Math.max(1, bounds.max[axis] - bounds.min[axis])
    this.pick.position.set(center[0] - offsetX, center[1], center[2])
    this.pick.scale.set(size(0), size(1), size(2))
  }

  /** Inexpensive setup objects, rebuilt whenever the plate changes. */
  private buildSetup(plate: ViewerPlate) {
    this.axes.position.set(...plate.workOrigin)
    this.stock.position.set(0, 0, 0)
    replaceChildren(this.stock, stockObjects(plate))
    const anchors = anchorMarkers(plate)
    replaceChildren(
      this.anchors,
      anchors.flatMap(({ marker, dot }) => [marker, dot])
    )
    this.anchorDiscs = anchors.map(({ marker }) => marker)
  }

  private loadFixtures(plate: ViewerPlate) {
    const generation = ++this.fixtureGeneration
    disposeMaterials(this.fixtureMaterials)
    for (const geometry of this.fixtureGeometries) geometry.dispose()
    this.fixtureMaterials = []
    this.fixtureGeometries = []
    this.fixtures.clear()
    this.fixtureGroups.clear()
    for (const instance of plate.fixtures ?? []) {
      const model = instance.definition.model
      if (!instance.enabled || !model) continue
      // A box is drawn from its bounds at once; a mesh once it has loaded.
      if (model.source.kind === "box") {
        this.addFixture(instance, model, null)
        continue
      }
      void this.context.assets.fixture(model.source).then((template) => {
        if (generation !== this.fixtureGeneration) return
        if (!template && model.source.kind !== "library") return
        this.addFixture(instance, model, template)
      })
    }
  }

  /** Draws a fixture: its mesh, else its box, see-through when its library model is missing. */
  private addFixture(
    instance: FixtureInstance,
    model: FixtureModel,
    template: THREE.Object3D | null
  ) {
    const missing = !template && model.source.kind === "library"
    const matte = isMatteKind(instance.definition.kind)
    // A kit fixture's bundled model has its own finish; others are drawn as their kind is.
    const { metalness, roughness } = fixtureModelFinish(model) ?? {
      metalness: matte ? 0 : 0.5,
      roughness: matte ? 0.95 : 0.55,
    }
    const material = new THREE.MeshStandardMaterial({
      color: instance.definition.color,
      metalness,
      roughness,
      transparent: missing,
      opacity: missing ? 0.35 : 1,
      depthWrite: !missing,
    })
    this.fixtureMaterials.push(material)
    let content: THREE.Object3D
    if (template) content = fixtureMesh(model, template, material)
    else {
      const box = fixtureBox(model, material)
      this.fixtureGeometries.push(box.geometry)
      content = box
    }
    const placed = placedFixture(instance, content)
    placed.userData.setupItem = {
      kind: "fixture",
      id: instance.id,
    } satisfies SetupItemRef
    this.fixtureGroups.set(instance.id, placed)
    this.fixtures.add(placed)
    // A fixture that loads while it is dragged starts where the drag has it.
    this.applyPreview()
    this.context.invalidate()
  }

  /** Where the item's box is drawn; null when the plate does not draw the item. */
  private itemFrame(item: SetupItemRef): ItemFrame | null {
    const plate = this.current
    const unplaced = { position: ZERO, rotation: ZERO }
    switch (item.kind) {
      case "bed":
        return { ...unplaced, box: this.machineBed.bounds }
      case "fixture": {
        const instance = plate.fixtures?.find(({ id }) => id === item.id)
        const model = instance?.definition.model
        if (!instance?.enabled || !model) return null
        const { position, rotation } = instance
        return { position, rotation, box: model.bounds }
      }
      case "stock": {
        const box = plateStockBounds(plate)
        return box && { ...unplaced, box }
      }
      case "design": {
        const origin = plate.workOrigin
        const extent = plate.toolpathBounds ?? BARE_ORIGIN
        return {
          ...unplaced,
          box: { min: plus(origin, extent.min), max: plus(origin, extent.max) },
        }
      }
    }
  }

  private renderOutline() {
    disposeObjects(this.outline)
    this.outline.clear()
    const frame = this.selectedItem && this.itemFrame(this.selectedItem)
    if (frame) this.outline.add(boxOutline(frame, this.context.palette.primary))
  }

  /** Draws every movable part where the plate has it, and the previewed item moved. */
  private applyPreview() {
    const preview = this.preview
    const moving = preview?.item.kind
    const fixtureId = preview?.item.kind === "fixture" ? preview.item.id : null
    const delta = preview?.delta ?? ZERO
    for (const instance of this.current.fixtures ?? []) {
      const group = this.fixtureGroups.get(instance.id)
      const shift = instance.id === fixtureId ? delta : ZERO
      group?.position.set(...plus(instance.position, shift))
    }
    this.stock.position.set(...(moving === "stock" ? delta : ZERO))
    // The design moves with the stock it is machined into.
    const designShift = moving === "stock" || moving === "design" ? delta : ZERO
    this.path.shift(designShift)
    this.axes.position.set(...plus(this.current.workOrigin, designShift))
    const selected = this.selectedItem
    const outlineMoves =
      !!preview &&
      !!selected &&
      (setupItemKey(selected) === setupItemKey(preview.item) ||
        (selected.kind === "design" && moving === "stock"))
    this.outline.position.set(...(outlineMoves ? delta : ZERO))
  }

  private applyPresentation() {
    const { presentation } = this
    this.selection.visible = presentation.active
    this.stock.visible = presentation.showStock
    this.path.present(presentation)
    this.problems.show(presentation.problems, presentation.shownProblem)
    const { machineOrigin } = presentation
    this.machineOrigin.visible = machineOrigin !== null
    if (machineOrigin) this.machineOrigin.position.set(...machineOrigin)
  }
}
