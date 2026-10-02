import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { kitForSetup } from "@/domain/fixtures/catalog"
import type { MachineCamera } from "@/domain/fixtures/fixture-kit"
import type { Point3 } from "@/domain/nc/gcode"
import type {
  ViewerPlate,
  ViewerProblem,
  ViewerProblemRef,
} from "@/components/workspace/viewer/viewer-input"
import {
  fitOrthographicBounds,
  layoutPlates,
  plateBed,
  plateKit,
  problemAnchor,
  problemMarkerId,
} from "../bed-viewer-layout"
import type { LineRange, PlatePlacement } from "../bed-viewer-layout"
import type { Playhead } from "@/domain/nc/move-times"
import { viewerPalette } from "./palette"
import { reconcilePlates } from "./plate-identity"
import { PlateView, bedGrid } from "./plate-view"
import type { PlatePresentation, PlateViewContext } from "./plate-view"
import { CLICK_TOLERANCE, SetupArranger } from "./setup-arranger"
import type { ArrangeEvents, ArrangeLabel, ArrangeView } from "./setup-arranger"
import { along } from "./toolpath-view"
import { ViewerAssets } from "./viewer-assets"
import type { ModelMeshes } from "./viewer-assets"
import { ViewerStage } from "./viewer-stage"

/**
 * The preset views; "camera" is the view through the machine's camera (`FixtureKit.camera`),
 * else the perspective.
 */
export type ViewMode = "perspective" | "top" | "front" | "camera"

/** Viewer-wide display state; only the selected plate follows playback and selection. */
export type ViewerPresentation = {
  selectedPlateId: string | null
  selectedLineRanges?: readonly LineRange[]
  /** Program lines each plate leaves out of the view, by plate id. */
  hiddenLineRanges?: Readonly<Record<string, readonly LineRange[]>>
  /** Fixtures each plate leaves out of the view (their ids), by plate id. */
  hiddenFixtures?: Readonly<Record<string, readonly string[]>>
  previewLine?: number | null
  previewProbePoint?: number | null
  progress: number
  showRapids: boolean
  showStock: boolean
  /** Problems to mark where they are on their plates' beds, and the one shown. */
  problems?: readonly ViewerProblem[]
  shownProblem?: ViewerProblemRef | null
  /** Where the connected machine keeps work zero, on one plate's bed. */
  machineOrigin?: MachineOrigin | null
  /** The tool the machine reports in its spindle, on one plate's bed (the simulator's camera). */
  liveTool?: LiveTool | null
}

/** A tool number and its tip, in that plate's bed coordinates. */
export type LiveTool = {
  readonly plateId: string
  readonly tool: number | null
  readonly position: Point3
}

/** A position on a plate's bed, in that plate's bed coordinates. */
export type MachineOrigin = {
  readonly plateId: string
  readonly position: Point3
}

export type BedSceneEvents = {
  selectPlate: (id: string) => void
  zoomChange: (zoom: number) => void
  error: (message: string) => void
  /** Selecting and moving setup items; without it, clicks select plates only. */
  arrange?: ArrangeEvents
}

const NO_RANGES: readonly LineRange[] = []
const NO_IDS: readonly string[] = []
const NO_PROBLEMS: readonly ViewerProblem[] = []
/** A shown problem whose marker is this far from the view's middle, or farther, is panned to. */
const REVEAL_REACH = 0.8
/** Camera offset from the orbit target for each preset view. */
const VIEW_DIRECTIONS: Record<Exclude<ViewMode, "camera">, Point3> = {
  perspective: [0, -540, 430],
  top: [0, -0.01, 650],
  front: [0, -650, 110],
}

/**
 * The Three.js side of the bed viewer. Frames render on demand: after control
 * input (until damping settles), resizes, state changes and asset loads.
 */
export class BedScene {
  private readonly container: HTMLElement
  private readonly labels: ReadonlyMap<string, HTMLElement>
  /** Problem markers, by `problemMarkerId`. */
  private readonly problemMarkers: ReadonlyMap<string, HTMLElement>
  /** The element the arranger's label shows in, such as where a picked point is. */
  private readonly arrangeLabelElement: { readonly current: HTMLElement | null }
  private arrangeLabel: ArrangeLabel | null = null
  private readonly events: BedSceneEvents
  private readonly stage: ViewerStage
  private readonly camera = new THREE.OrthographicCamera(
    -190,
    190,
    190,
    -190,
    0.1,
    3000
  )
  private readonly controls: OrbitControls
  private view: ViewMode = "perspective"
  /** The plates' machine's camera, while the view is through it. */
  private machineCamera: MachineCamera | null = null
  /** The view through the machine's camera: its lens, so in perspective. */
  private readonly lens = new THREE.PerspectiveCamera(45, 4 / 3, 1, 3000)
  /** Where the spindle last was along the bed's Y, which the machine's camera is level with. */
  private spindleY: number | null = null
  private readonly assets: ViewerAssets
  private readonly context: PlateViewContext
  /**
   * Each plate is drawn on its own machine's bed (`plateKit`); without plates, the scene shows
   * the bed of the machine a setup naming none is for.
   */
  private readonly emptyBed = kitForSetup({ deviceId: null, fixtures: [] }).bed
  private readonly emptyGrid = bedGrid(this.emptyBed)
  private readonly raycaster = new THREE.Raycaster()
  private readonly projected = new THREE.Vector3()
  private readonly views = new Map<string, PlateView>()
  private plates: readonly ViewerPlate[] = []
  private layout = layoutPlates([], this.emptyBed)
  private playhead: Playhead | null = null
  private presentation: ViewerPresentation = {
    selectedPlateId: null,
    progress: 100,
    showRapids: false,
    showStock: true,
  }
  private pointerStart: {
    x: number
    y: number
    id: number
    /** A right click, or a Control-click (the Mac's secondary click). */
    secondary: boolean
  } | null = null
  private readonly arranger: SetupArranger | null
  /** The anchor hover raycast runs at most once per frame, from the latest pointer position. */
  private hoverAnchorFrame = 0
  private hoverAnchorEvent: PointerEvent | null = null

  /** Returns null when WebGL is unavailable. */
  static create(
    container: HTMLElement,
    labels: ReadonlyMap<string, HTMLElement>,
    problemMarkers: ReadonlyMap<string, HTMLElement>,
    arrangeLabel: { readonly current: HTMLElement | null },
    events: BedSceneEvents,
    meshes: ModelMeshes
  ) {
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      return null
    }
    return new BedScene(
      container,
      renderer,
      labels,
      problemMarkers,
      arrangeLabel,
      events,
      meshes
    )
  }

  private constructor(
    container: HTMLElement,
    renderer: THREE.WebGLRenderer,
    labels: ReadonlyMap<string, HTMLElement>,
    problemMarkers: ReadonlyMap<string, HTMLElement>,
    arrangeLabel: { readonly current: HTMLElement | null },
    events: BedSceneEvents,
    meshes: ModelMeshes
  ) {
    this.container = container
    this.labels = labels
    this.problemMarkers = problemMarkers
    this.arrangeLabelElement = arrangeLabel
    this.events = events
    // Until plates are laid out, the perspective view looks at the middle of the bed's top.
    const { min, max } = this.emptyBed.bounds
    const bedCenter = new THREE.Vector3(
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      max[2]
    )
    this.camera.up.set(0, 0, 1)
    this.camera.position
      .copy(bedCenter)
      .add(new THREE.Vector3(...VIEW_DIRECTIONS.perspective))
    this.stage = new ViewerStage(container, renderer, this.frame, {
      resize: (width, height) => {
        // Resizing a settings panel must preserve the current focus and view scale.
        const halfHeight = (this.camera.top - this.camera.bottom) / 2
        const halfWidth = halfHeight * (width / height)
        const centerX = (this.camera.left + this.camera.right) / 2
        this.camera.left = centerX - halfWidth
        this.camera.right = centerX + halfWidth
        this.camera.updateProjectionMatrix()
        this.lens.aspect = width / height
        this.lens.updateProjectionMatrix()
      },
    })
    this.controls = new OrbitControls(this.camera, renderer.domElement)
    this.controls.target.copy(bedCenter)
    // Damping stays off; if enabled, frames continue until the controls settle.
    this.controls.enableDamping = false
    this.controls.minZoom = 0.2
    this.controls.maxZoom = 12
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.addEventListener("change", this.stage.invalidate)
    // Wheel and pinch zoom change the camera directly; report it so toolbar steps start from it.
    this.controls.addEventListener("end", () =>
      events.zoomChange(this.camera.zoom)
    )
    this.stage.scene.add(this.emptyGrid)
    this.assets = new ViewerAssets(
      {
        bedChange: (machineBed, template) => {
          for (const view of this.views.values())
            view.setBed(machineBed, template)
          this.stage.invalidate()
        },
        error: events.error,
      },
      meshes
    )
    this.context = {
      palette: viewerPalette(container),
      assets: this.assets,
      invalidate: this.stage.invalidate,
      pixelRatio: renderer.getPixelRatio(),
    }
    this.stage.resize()
    const canvas = renderer.domElement
    this.arranger = events.arrange
      ? new SetupArranger(
          {
            canvas,
            camera: this.camera,
            controls: this.controls,
            raycaster: this.raycaster,
            aim: (event) => this.aim(event),
            invalidate: this.stage.invalidate,
            view: (plateId) => this.views.get(plateId),
            views: () => this.views.entries(),
            offset: (plateId) =>
              this.layout.placements.find(({ id }) => id === plateId)
                ?.offsetX ?? 0,
            plateAt: (event) => this.plateAt(event),
            label: (label) => this.showArrangeLabel(label),
          },
          events.arrange
        )
      : null
    // Capturing, so a drag that starts on an item can stop orbiting before it begins.
    canvas.addEventListener("pointerdown", this.pointerDown, { capture: true })
    canvas.addEventListener("pointerup", this.pointerUp)
    canvas.addEventListener("pointercancel", this.pointerCancel)
    canvas.addEventListener("pointermove", this.pointerMove)
    canvas.addEventListener("pointerleave", this.pointerLeave)
    if (this.arranger) window.addEventListener("keydown", this.keyDown)
  }

  /** Keeps the views of plates that render identically; builds, updates or disposes the rest. */
  setPlates(plates: readonly ViewerPlate[]) {
    const previous = this.plates
    const next = reconcilePlates(plates, (id) => this.views.get(id)?.plate)
    if (
      next.length === previous.length &&
      next.every((plate, index) => plate === previous[index])
    )
      return
    const arrangementChanged =
      next.length !== previous.length ||
      next.some((plate, index) => previous[index]?.id !== plate.id)
    this.plates = next
    this.layout = layoutPlates(next, this.emptyBed)
    this.emptyGrid.visible = next.length === 0
    this.stage.canvas.removeAttribute("title")
    const ids = new Set(next.map((plate) => plate.id))
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue
      view.dispose()
      this.views.delete(id)
    }
    for (const placement of this.layout.placements) {
      const plate = next[placement.index]
      const view = this.views.get(plate.id)
      // A view keeps the bed it was made on; a plate set up on another machine, or with its bed
      // moved, is drawn anew.
      if (view?.machineBed === plateBed(plate)) view.update(plate, placement)
      else {
        view?.dispose()
        this.addView(plate, placement)
      }
    }
    // Toolpath, setup and selection changes update geometry without moving the camera; the view
    // through the machine's camera is through that of the machine now shown, level with its tool.
    if (arrangementChanged && this.view === "camera") this.setView(this.view)
    else if (arrangementChanged) this.center()
    else this.placeLens()
    this.arranger?.platesChanged()
    this.stage.invalidate()
  }

  /** The selected setup item, move mode and its options. */
  arrange(view: ArrangeView) {
    this.arranger?.set(view)
  }

  /**
   * Where simulated playback is along the selected plate's moves: it moves every frame, and only
   * that plate's path follows.
   */
  setPlayhead(playhead: Playhead | null) {
    this.playhead = playhead
    this.present(this.presentation)
  }

  /** Only plates whose presentation changed update; playback touches the selected plate alone. */
  present(presentation: ViewerPresentation) {
    const previous = this.presentation
    this.presentation = presentation
    let changed = false
    for (const [id, view] of this.views)
      if (view.present(this.platePresentation(id))) changed = true
    // The points moves snap to follow the fixtures shown.
    if (presentation.hiddenFixtures !== previous.hiddenFixtures)
      this.arranger?.platesChanged()
    if (changed) this.stage.invalidate()
    this.placeLens()
  }

  /** A preset, or the view through the first plate's machine's camera, else the perspective. */
  setView(view: ViewMode) {
    this.view = view
    const plate = this.plates.at(0)
    const kit = plate
      ? plateKit(plate)
      : kitForSetup({ deviceId: null, fixtures: [] })
    this.machineCamera = view === "camera" ? kit.camera : null
    // The machine's camera is where it is mounted: it does not orbit, pan or zoom.
    this.controls.enabled = !this.machineCamera
    if (this.machineCamera) {
      this.placeLens()
      return
    }
    const direction = VIEW_DIRECTIONS[view === "camera" ? "perspective" : view]
    this.camera.position
      .copy(this.controls.target)
      .add(new THREE.Vector3(...direction))
    this.center()
  }

  /**
   * Puts the lens where the machine's camera is. Fixed to the frame, the camera sees the bed move
   * along Y under the spindle, so it is level with the tool: where the playhead has it on the
   * selected plate, else where the machine reports it, else where it last was (at first, over
   * the middle of the plates' beds).
   */
  private placeLens() {
    const camera = this.machineCamera
    if (!camera) return
    const { selectedPlateId } = this.presentation
    this.spindleY = this.toolY(selectedPlateId) ?? this.spindleY
    const { min, max } = this.layout.bounds
    const y = this.spindleY ?? (min[1] + max[1]) / 2
    const x =
      selectedPlateId === null ? 0 : (this.offsetOf(selectedPlateId) ?? 0)
    const onBed = ([px, py, pz]: Point3) =>
      new THREE.Vector3(px + x, py + y, pz)
    this.lens.fov = camera.fov
    this.lens.updateProjectionMatrix()
    this.lens.up.set(0, 0, 1)
    this.lens.position.copy(onBed(camera.position))
    this.lens.lookAt(onBed(camera.target))
    this.stage.invalidate()
  }

  /** Where the tool is along a plate's bed's Y: at the playhead, else where the machine reports it. */
  private toolY(plateId: string | null): number | null {
    const plate = this.plates.find(({ id }) => id === plateId)
    if (!plate) return null
    const { playhead } = this
    const segment =
      playhead && plate.machineProgram.segments.at(playhead.segment)
    if (playhead && segment)
      return along(segment, playhead.fraction)[1] + plate.workOrigin[1]
    const { liveTool } = this.presentation
    return liveTool?.plateId === plateId ? liveTool.position[1] : null
  }

  /**
   * Brings a problem's marker into the middle of the view when it is near an edge or beyond,
   * panning without turning or zooming.
   */
  reveal(ref: ViewerProblemRef) {
    const problem = this.presentation.problems?.find(
      (item) => item.plateId === ref.plateId && item.key === ref.key
    )
    const offset = problem ? this.offsetOf(problem.plateId) : null
    if (!problem || offset === null) return
    const [x, y, z] = problemAnchor(problem)
    const target = new THREE.Vector3(x + offset, y, z)
    const projected = target.clone().project(this.camera)
    if (
      Math.abs(projected.x) < REVEAL_REACH &&
      Math.abs(projected.y) < REVEAL_REACH
    )
      return
    // The view is orthographic: what shows at its middle lies in the target's plane.
    const middle = new THREE.Vector3(0, 0, projected.z).unproject(this.camera)
    const shift = target.sub(middle)
    this.camera.position.add(shift)
    this.controls.target.add(shift)
    this.controls.update()
    this.stage.invalidate()
  }

  setZoom(zoom: number) {
    this.camera.zoom = zoom
    this.camera.updateProjectionMatrix()
    this.stage.invalidate()
  }

  dispose() {
    cancelAnimationFrame(this.hoverAnchorFrame)
    this.arranger?.dispose()
    const canvas = this.stage.canvas
    canvas.removeEventListener("pointerdown", this.pointerDown, {
      capture: true,
    })
    canvas.removeEventListener("pointerup", this.pointerUp)
    canvas.removeEventListener("pointercancel", this.pointerCancel)
    canvas.removeEventListener("pointermove", this.pointerMove)
    canvas.removeEventListener("pointerleave", this.pointerLeave)
    window.removeEventListener("keydown", this.keyDown)
    this.controls.dispose()
    for (const view of this.views.values()) view.dispose()
    this.views.clear()
    this.assets.dispose()
    this.stage.dispose()
  }

  private addView(plate: ViewerPlate, placement: PlatePlacement) {
    const view = new PlateView(
      plate,
      placement,
      this.platePresentation(plate.id),
      this.context
    )
    this.views.set(plate.id, view)
    this.stage.scene.add(view.root)
  }

  private platePresentation(id: string): PlatePresentation {
    const { selectedPlateId, selectedLineRanges, showRapids, showStock } =
      this.presentation
    const { problems = NO_PROBLEMS, shownProblem } = this.presentation
    const hidden = this.presentation.hiddenLineRanges?.[id] ?? NO_RANGES
    const hiddenFixtures = this.presentation.hiddenFixtures?.[id] ?? NO_IDS
    const { machineOrigin, liveTool } = this.presentation
    const marked = {
      hiddenFixtures,
      problems: problems.filter((problem) => problem.plateId === id),
      shownProblem: shownProblem?.plateId === id ? shownProblem.key : null,
      machineOrigin:
        machineOrigin?.plateId === id ? machineOrigin.position : null,
      liveTool:
        liveTool?.plateId === id
          ? { tool: liveTool.tool, position: liveTool.position }
          : null,
    }
    if (id !== selectedPlateId)
      return {
        active: false,
        showRapids,
        showStock,
        ranges: NO_RANGES,
        hidden,
        progress: 100,
        ...marked,
      }
    const { progress, previewLine, previewProbePoint } = this.presentation
    const { playhead } = this
    return {
      active: true,
      showRapids,
      showStock,
      ranges: selectedLineRanges ?? NO_RANGES,
      hidden,
      progress,
      previewLine,
      previewProbePoint,
      playhead,
      ...marked,
    }
  }

  /** How far a plate is laid out along X; null for a plate not on the bed. */
  private offsetOf(plateId: string): number | null {
    return (
      this.layout.placements.find(({ id }) => id === plateId)?.offsetX ?? null
    )
  }

  /** What the view is drawn through: the machine camera's lens, else the preset's camera. */
  private get eye(): THREE.Camera {
    return this.machineCamera ? this.lens : this.camera
  }

  private readonly frame = () => {
    const settling = this.controls.update()
    this.stage.renderer.render(this.stage.scene, this.eye)
    this.positionLabels()
    return settling
  }

  private positionLabels() {
    const { clientWidth: width } = this.container
    for (const placement of this.layout.placements) {
      const label = this.labels.get(placement.id)
      if (!label) continue
      this.pin(label, placement.label)
      label.style.maxWidth = `${Math.max(34, width / Math.max(1, this.views.size) - 12)}px`
    }
    for (const problem of this.presentation.problems ?? NO_PROBLEMS) {
      const marker = this.problemMarkers.get(problemMarkerId(problem))
      const offset = this.offsetOf(problem.plateId)
      if (!marker) continue
      if (offset === null) {
        marker.style.visibility = "hidden"
        continue
      }
      const [x, y, z] = problemAnchor(problem)
      this.pin(marker, [x + offset, y, z])
    }
    this.pinArrangeLabel()
  }

  /** Shows the arranger's label beside its point, or hides it (null). */
  private showArrangeLabel(label: ArrangeLabel | null) {
    this.arrangeLabel = label
    const element = this.arrangeLabelElement.current
    if (element && label) element.textContent = label.text
    this.pinArrangeLabel()
  }

  private pinArrangeLabel() {
    const element = this.arrangeLabelElement.current
    if (!element) return
    const label = this.arrangeLabel
    const offset = label ? this.offsetOf(label.plateId) : null
    if (!label || offset === null) {
      element.style.visibility = "hidden"
      return
    }
    const [x, y, z] = label.position
    this.pin(element, [x + offset, y, z])
  }

  /** Puts an overlay element where a point shows, hidden when the point is out of view. */
  private pin(element: HTMLElement, point: Point3) {
    const { clientWidth: width, clientHeight: height } = this.container
    const projected = this.projected.set(...point).project(this.eye)
    element.style.left = `${((projected.x + 1) * width) / 2}px`
    element.style.top = `${((1 - projected.y) * height) / 2}px`
    element.style.visibility =
      Math.abs(projected.x) <= 1 &&
      Math.abs(projected.y) <= 1 &&
      Math.abs(projected.z) <= 1
        ? "visible"
        : "hidden"
  }

  private fit() {
    const right = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(this.camera.quaternion)
      .toArray()
    const up = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(this.camera.quaternion)
      .toArray()
    Object.assign(
      this.camera,
      fitOrthographicBounds(
        this.layout.bounds,
        right,
        up,
        this.container.clientWidth / Math.max(1, this.container.clientHeight)
      )
    )
    this.camera.updateProjectionMatrix()
    this.stage.invalidate()
  }

  private center() {
    const bounds = this.layout.bounds
    const target = new THREE.Vector3(...bounds.min)
      .add(new THREE.Vector3(...bounds.max))
      .multiplyScalar(0.5)
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize()
    const diagonal = new THREE.Vector3(...bounds.max)
      .sub(new THREE.Vector3(...bounds.min))
      .length()
    this.camera.position
      .copy(target)
      .addScaledVector(direction, Math.max(650, diagonal * 1.6))
    this.camera.far = Math.max(3000, diagonal * 8)
    this.controls.target.copy(target)
    this.controls.update()
    this.fit()
  }

  /** Casts the picking ray through a pointer position on the canvas. */
  private aim(event: MouseEvent) {
    const rect = this.stage.canvas.getBoundingClientRect()
    this.raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      ),
      this.eye
    )
    this.stage.scene.updateMatrixWorld(true)
  }

  private readonly hoverAnchor = (event: PointerEvent) => {
    const canvas = this.stage.canvas
    if (event.buttons) {
      canvas.removeAttribute("title")
      return
    }
    this.aim(event)
    const hit = this.raycaster
      .intersectObjects(
        [...this.views.values()].flatMap((view) => view.anchorPicks),
        false
      )
      .at(0)
    const title: unknown = hit?.object.userData.anchorTitle
    if (typeof title === "string") canvas.title = title
    else canvas.removeAttribute("title")
  }

  private readonly pointerMove = (event: PointerEvent) => {
    if (this.arranger?.pointerMove(event)) return
    // Hovering looks for an anchor under the pointer once per frame, as the arranger does.
    this.hoverAnchorEvent = event
    this.hoverAnchorFrame ||= requestAnimationFrame(() => {
      this.hoverAnchorFrame = 0
      if (this.hoverAnchorEvent) this.hoverAnchor(this.hoverAnchorEvent)
    })
  }

  private readonly pointerLeave = () => {
    this.stage.canvas.removeAttribute("title")
    this.arranger?.leave()
  }

  private readonly pointerDown = (event: PointerEvent) => {
    this.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId,
      secondary: event.button === 2 || (event.button === 0 && event.ctrlKey),
    }
    this.arranger?.pointerDown(event)
  }

  private readonly pointerUp = (event: PointerEvent) => {
    const start = this.pointerStart
    this.pointerStart = null
    if (this.arranger?.pointerUp(event)) return
    // A press that travelled orbited or panned the view; it was not a click.
    if (
      !start ||
      start.id !== event.pointerId ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) >
        CLICK_TOLERANCE
    )
      return
    if (this.arranger) {
      // Only a primary or a secondary click picks; the middle button zooms.
      if (start.secondary || event.button === 0)
        this.arranger.click(event, start.secondary)
      return
    }
    if (event.button !== 0) return
    const plateId = this.plateAt(event)
    if (plateId) this.events.selectPlate(plateId)
  }

  private readonly pointerCancel = () => {
    this.pointerStart = null
    this.arranger?.cancel()
  }

  private readonly keyDown = (event: KeyboardEvent) => {
    if (this.arranger?.keyDown(event)) event.preventDefault()
  }

  /** The plate whose area is under the pointer. */
  private plateAt(event: MouseEvent): string | null {
    this.aim(event)
    const hit = this.raycaster
      .intersectObjects(
        [...this.views.values()].map((view) => view.pick),
        false
      )
      .at(0)
    const id: unknown = hit?.object.userData.plateId
    return typeof id === "string" ? id : null
  }
}
