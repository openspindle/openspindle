import * as THREE from "three"
import type { OrbitControls } from "three/addons/controls/OrbitControls.js"
import {
  alignment,
  moveAxesMask,
  sameSetupItem,
} from "@/domain/plate/setup-items"
import type {
  MoveAxes,
  SetupItemRef,
  SetupPoint,
} from "@/domain/plate/setup-items"
import type { Point3 } from "@/domain/nc/gcode"
import { sameEdge } from "@/domain/plate/item-edges"
import type { ItemEdge, ItemEdgeRef } from "@/domain/plate/item-edges"
import type { PickTarget } from "@/domain/plate/pick-targets"
import { WORK_AXIS_LENGTH, plateItemEdges } from "../bed-viewer-layout"
import type { EdgeHighlight } from "./edge-highlights"
import type { PlateView } from "./plate-view"
import type { Marker, MarkerStyle } from "./setup-markers"

/** Pointer travel in CSS pixels that still counts as a click. */
export const CLICK_TOLERANCE = 5
/** How near the pointer must be to a point to pick it, in CSS pixels. */
const PICK_RADIUS = 9
/**
 * How near a moving point must come to another point to snap to it, and a picked point to a
 * target, in CSS pixels.
 */
const SNAP_RADIUS = 10
/** How near an edge, in CSS pixels, the pointer picks it. */
const EDGE_RADIUS = 10
/** How near the pointer must be to the work origin's axes to pick the design. */
const DESIGN_RADIUS = 8
/** Free moves step by a tenth of a millimetre. */
const STEP = 0.1
const ZERO: Point3 = [0, 0, 0]
const AXES = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
] as const

export type ArrangeSelection = {
  readonly plateId: string
  readonly item: SetupItemRef
}

/**
 * Picking for an operation on one plate: a point to start it at, or edges for it to trace. While
 * it lasts, clicks pick instead of selecting, and nothing moves.
 */
export type ArrangePicking =
  | {
      readonly kind: "point"
      readonly plateId: string
      /** What a picked point snaps to, marked while it is picked. */
      readonly targets: readonly PickTarget[]
    }
  | {
      readonly kind: "edges"
      readonly plateId: string
      /** The edges chosen so far, drawn while edges are picked. */
      readonly edges: readonly ItemEdgeRef[]
    }

/** A point picked on a plate: a target it snapped to, or else where the pointer met a surface. */
export type PickedPoint = {
  /** In bed coordinates. */
  readonly position: Point3
  readonly target: PickTarget | null
}

/** The arrangement the host shows; its owner sets it on every change. */
export type ArrangeView = {
  readonly selection: ArrangeSelection | null
  /** Drags and point picks move the selected item; only set when it can move. */
  readonly moving: boolean
  readonly axes: MoveAxes
  readonly snap: boolean
  readonly picking: ArrangePicking | null
}

/** The point picked on the moving item, which the next other point it is aligned to. */
export type ArrangePick = {
  readonly from: SetupPoint | null
  /** Set when a point of something else was clicked before one of the item's own. */
  readonly notice: "pick-own-point" | null
}

/** A drag in progress: how far the item has moved, and what it snapped to. */
export type ArrangeDrag = {
  readonly delta: Point3
  readonly snappedTo: string | null
}

export type ArrangeMenuRequest = {
  /** Where the menu opens, in client coordinates. */
  readonly x: number
  readonly y: number
  /** A picked point of the moving item and the point right-clicked: an alignment on offer. */
  readonly alignment: {
    readonly from: SetupPoint
    readonly to: SetupPoint
  } | null
}

export type ArrangeEvents = {
  /** An item was clicked; `item` null when a plate was clicked beside its items, or nothing. */
  select: (plateId: string | null, item: SetupItemRef | null) => void
  /** Moves an item; false when the move was refused. */
  move: (plateId: string, item: SetupItemRef, delta: Point3) => boolean
  menu: (request: ArrangeMenuRequest) => void
  pick: (pick: ArrangePick) => void
  drag: (drag: ArrangeDrag | null) => void
  /** A point was clicked while picking a point. */
  pickPoint: (plateId: string, pick: PickedPoint) => void
  /** An edge was clicked while picking edges. */
  pickEdge: (plateId: string, edge: ItemEdgeRef) => void
}

/** Text the host shows beside a point of a plate's bed (in bed coordinates). */
export type ArrangeLabel = {
  readonly plateId: string
  readonly position: Point3
  readonly text: string
}

/** What the arranger uses of the scene. */
export type ArrangeHost = {
  readonly canvas: HTMLCanvasElement
  readonly camera: THREE.Camera
  readonly controls: OrbitControls
  readonly raycaster: THREE.Raycaster
  /** Casts the picking ray through the pointer. */
  aim: (event: MouseEvent) => void
  invalidate: () => void
  view: (plateId: string) => PlateView | undefined
  views: () => Iterable<[string, PlateView]>
  /** How far a plate is drawn along X from its bed coordinates. */
  offset: (plateId: string) => number
  /** The plate whose area is under the pointer. */
  plateAt: (event: MouseEvent) => string | null
  /** Shows a label beside a point, or hides it (null). */
  label: (label: ArrangeLabel | null) => void
}

type ItemUnderPointer = {
  readonly plateId: string
  readonly item: SetupItemRef
  /** Where the item was hit, in world coordinates. */
  readonly grab: THREE.Vector3
}

type Drag = {
  readonly pointerId: number
  readonly plateId: string
  readonly item: SetupItemRef
  readonly grab: THREE.Vector3
  readonly axes: MoveAxes
  readonly own: readonly SetupPoint[]
  readonly targets: readonly SetupPoint[]
  readonly x: number
  readonly y: number
  delta: Point3
  snapped: { own: SetupPoint; target: SetupPoint } | null
  moved: boolean
}

type Press = {
  readonly pointerId: number
  readonly point: SetupPoint
  /** Where the selected item is under the pressed point, when that is another item's. */
  readonly grab: THREE.Vector3 | null
  readonly x: number
  readonly y: number
}

/** A point near the pointer, as the pick weighs it. */
type PointPick = {
  readonly point: SetupPoint
  readonly distance: number
  readonly own: boolean
  readonly depth: number
}

/**
 * The nearer point wins. Within a pixel the moving item's own point does (a dowel pin's centre
 * is on the hole it stands in), then the one nearer to the eye.
 */
function betterPick(candidate: PointPick, best: PointPick | null) {
  if (!best) return true
  if (Math.abs(candidate.distance - best.distance) > 1)
    return candidate.distance < best.distance
  if (candidate.own !== best.own) return candidate.own
  return candidate.depth < best.depth
}

const plus = (point: Point3, delta: Point3): Point3 => [
  point[0] + delta[0],
  point[1] + delta[1],
  point[2] + delta[2],
]

const isZero = (delta: Point3) => delta.every((value) => Math.abs(value) < 1e-9)

const toStep = (value: number) =>
  Number((Math.round(value / STEP) * STEP).toFixed(3)) + 0

const sameSelection = (
  a: ArrangeSelection | null,
  b: ArrangeSelection | null
) =>
  a === b ||
  (!!a && !!b && a.plateId === b.plateId && sameSetupItem(a.item, b.item))

const millimetres = (value: number) => Number(value.toFixed(3))

const pointTitle = ({ label, position: [x, y, z] }: SetupPoint) =>
  `${label} · X ${millimetres(x)}, Y ${millimetres(y)}, Z ${millimetres(z)} mm`

/** A picked point's bed X and Y, under the target it snapped to. */
function pickedText({ position: [x, y], target }: PickedPoint) {
  const at = `X ${x.toFixed(3)}, Y ${y.toFixed(3)} mm`
  return target ? `${target.label}\n${at}` : at
}

function distanceToSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t =
    length > 0
      ? Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)
        )
      : 0
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}

/** The point of a line (through `point`, along `direction`) nearest a ray; null when parallel. */
function nearestOnLine(
  ray: THREE.Ray,
  point: THREE.Vector3,
  direction: THREE.Vector3
) {
  const along = ray.direction.dot(direction)
  const denominator = 1 - along * along
  if (Math.abs(denominator) < 1e-6) return null
  const offset = new THREE.Vector3().subVectors(ray.origin, point)
  const t =
    (direction.dot(offset) - along * ray.direction.dot(offset)) / denominator
  return point.clone().addScaledVector(direction, t)
}

/** Keys typed into a field, a menu or a dialog are theirs, not the viewer's. */
export function keyForViewer(event: KeyboardEvent) {
  const target = event.target
  if (!(target instanceof HTMLElement)) return true
  if (target.isContentEditable) return false
  if (target.closest("input, textarea, select, [role=textbox]")) return false
  return !target.closest(
    "[role=menu], [role=dialog], [role=alertdialog], [role=listbox]"
  )
}

/**
 * Selecting and moving setup items in the bed viewer. A click selects what is under the
 * pointer. In move mode the selected item follows drags (along the chosen axes, snapping its
 * points to other points), and clicking one of its points and then another point moves it so
 * the two meet.
 */
export class SetupArranger {
  private readonly host: ArrangeHost
  private readonly events: ArrangeEvents
  private state: ArrangeView = {
    selection: null,
    moving: false,
    axes: "xy",
    snap: true,
    picking: null,
  }
  private from: SetupPoint | null = null
  private hover: SetupPoint | null = null
  /** What a click would pick while a point is picked. */
  private hoverPick: PickedPoint | null = null
  /** The edge under the pointer while edges are picked. */
  private hoverEdge: ItemEdge | null = null
  private drag: Drag | null = null
  private press: Press | null = null
  /** A committed move, drawn until a new version of its plate (which carries it) arrives. */
  private pending: {
    plateId: string
    plate: PlateView["plate"] | undefined
    delta: Point3
  } | null = null
  private hoverFrame = 0
  private hoverEvent: PointerEvent | null = null
  /** Whether the owner last heard of no picked point and no notice. */
  private pickEmpty = true
  private readonly projected = new THREE.Vector3()

  constructor(host: ArrangeHost, events: ArrangeEvents) {
    this.host = host
    this.events = events
  }

  set(state: ArrangeView) {
    const selectionChanged = !sameSelection(
      this.state.selection,
      state.selection
    )
    const pickingChanged =
      this.state.picking?.kind !== state.picking?.kind ||
      this.state.picking?.plateId !== state.picking?.plateId
    this.state = state
    if (selectionChanged || !state.moving) {
      this.cancelDrag()
      this.cancelPress()
      this.from = null
      this.reportPick({ from: null, notice: null })
    }
    // Picking keeps what is under the pointer while its choices change.
    if ((!state.moving && !state.picking) || pickingChanged) {
      this.hover = null
      this.hoverEdge = null
      this.hoverPick = null
      this.host.label(null)
      this.host.canvas.style.cursor = state.picking ? "crosshair" : ""
      this.host.canvas.removeAttribute("title")
    }
    this.refresh()
  }

  /** Plates changed: outlines and points follow, and a move that arrived is no longer pending. */
  platesChanged() {
    const { pending } = this
    if (pending && this.host.view(pending.plateId)?.plate !== pending.plate)
      this.pending = null
    const from = this.from
    const selection = this.state.selection
    if (from && selection) {
      const current = this.host
        .view(selection.plateId)
        ?.setupPoints()
        .find((point) => point.key === from.key)
      if (
        !current ||
        current.position.some((value, axis) => value !== from.position[axis])
      )
        this.setFrom(null)
    }
    this.refresh()
  }

  pointerDown(event: PointerEvent) {
    const { selection, moving, picking } = this.state
    if (
      picking ||
      !moving ||
      !selection ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return
    const point = this.pointAt(event)
    if (point) {
      this.press = {
        pointerId: event.pointerId,
        point,
        grab: this.isOwn(point) ? null : this.grabAt(event),
        x: event.clientX,
        y: event.clientY,
      }
      this.hold(event.pointerId)
      return
    }
    const grab = this.grabAt(event)
    if (grab) this.startDrag(selection, event.pointerId, event, grab)
  }

  /** Grabs the selected item at a world point; the pointer's travel from `start` moves it. */
  private startDrag(
    selection: ArrangeSelection,
    pointerId: number,
    start: { clientX: number; clientY: number },
    grab: THREE.Vector3
  ) {
    const view = this.host.view(selection.plateId)
    if (!view) return
    const points = view.setupPoints()
    this.drag = {
      pointerId,
      plateId: selection.plateId,
      item: selection.item,
      grab: grab.clone(),
      axes: this.state.axes,
      own: points.filter((candidate) => this.isOwn(candidate)),
      targets: points.filter((candidate) => !this.isOwn(candidate)),
      x: start.clientX,
      y: start.clientY,
      delta: ZERO,
      snapped: null,
      moved: false,
    }
    this.hold(pointerId)
    this.host.canvas.style.cursor = "grabbing"
  }

  /** Returns whether the pointer move was the arranger's. */
  pointerMove(event: PointerEvent) {
    if (this.drag?.pointerId === event.pointerId) {
      this.dragTo(event, this.drag)
      return true
    }
    const { press } = this
    if (press) {
      const travel = Math.hypot(
        event.clientX - press.x,
        event.clientY - press.y
      )
      const selection = this.state.selection
      if (
        travel > CLICK_TOLERANCE &&
        selection &&
        press.pointerId === event.pointerId
      ) {
        // Pulling one of the item's own points grabs the item there; pulling another item's
        // point drawn over the item grabs the item where it was pressed.
        const [x, y, z] = press.point.position
        const grab = this.isOwn(press.point)
          ? new THREE.Vector3(x + this.host.offset(selection.plateId), y, z)
          : press.grab
        if (grab) {
          this.press = null
          this.startDrag(
            selection,
            press.pointerId,
            { clientX: press.x, clientY: press.y },
            grab
          )
          if (this.drag) this.dragTo(event, this.drag)
        }
      }
      return true
    }
    const picking = !!this.state.picking
    if (
      (!picking && (!this.state.moving || !this.state.selection)) ||
      event.buttons
    )
      return false
    // Hovering looks for points and the item under the pointer once per frame.
    this.hoverEvent = event
    this.hoverFrame ||= requestAnimationFrame(() => {
      this.hoverFrame = 0
      if (this.hoverEvent) this.hoverAt(this.hoverEvent)
    })
    return true
  }

  /** Returns whether the pointer release ended the arranger's drag or point press. */
  pointerUp(event: PointerEvent) {
    const { drag, press } = this
    if (drag?.pointerId === event.pointerId) {
      this.drag = null
      this.release(event.pointerId)
      this.host.canvas.style.cursor = "grab"
      this.events.drag(null)
      if (drag.moved && !isZero(drag.delta))
        this.commit(drag.plateId, drag.item, drag.delta)
      else this.host.view(drag.plateId)?.setPreview(drag.item, null)
      this.refresh()
      return true
    }
    if (press?.pointerId === event.pointerId) {
      this.press = null
      this.release(event.pointerId)
      const travel = Math.hypot(
        event.clientX - press.x,
        event.clientY - press.y
      )
      if (travel <= CLICK_TOLERANCE) this.clickPoint(press.point)
      return true
    }
    return false
  }

  /**
   * A click that was not a drag: selects, or opens the menu for a secondary click. While picking
   * it picks what is under the pointer, and selects nothing.
   */
  click(event: PointerEvent, secondary: boolean) {
    const { picking } = this.state
    if (picking) {
      if (secondary) return
      if (picking.kind === "point") {
        const pick = this.pickAt(event)
        if (pick) this.events.pickPoint(picking.plateId, pick)
      } else {
        const edge = this.edgeAt(event)
        if (edge) this.events.pickEdge(picking.plateId, edge.ref)
      }
      return
    }
    if (secondary) {
      this.openMenu(event)
      return
    }
    const hit = this.itemAt(event)
    if (hit) this.events.select(hit.plateId, hit.item)
    else this.events.select(this.host.plateAt(event), null)
  }

  leave() {
    if (
      this.drag ||
      this.press ||
      (!this.hover && !this.hoverEdge && !this.hoverPick)
    )
      return
    this.hover = null
    this.hoverEdge = null
    this.hoverPick = null
    this.host.label(null)
    this.refresh()
  }

  /** Escape drops a drag, then a picked point; returns whether it did. */
  keyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !keyForViewer(event)) return false
    if (this.drag) {
      this.cancelDrag()
      this.refresh()
      return true
    }
    if (this.from) {
      this.setFrom(null)
      return true
    }
    return false
  }

  cancel() {
    this.cancelDrag()
    this.cancelPress()
    this.refresh()
  }

  dispose() {
    cancelAnimationFrame(this.hoverFrame)
    this.hoverEvent = null
  }

  private isOwn(point: SetupPoint) {
    const selection = this.state.selection
    if (!selection || !point.item) return false
    return (
      sameSetupItem(point.item, selection.item) ||
      // The design moves with the stock it is machined into.
      (selection.item.kind === "stock" && point.item.kind === "design")
    )
  }

  private markerStyle(point: SetupPoint, own: boolean): MarkerStyle {
    if (own) return "own"
    return point.item ? "target" : "anchor"
  }

  private markersFor(plateId: string): Marker[] | null {
    const { selection, moving, picking } = this.state
    if (picking) {
      // What a picked point snaps to, the one it snaps to now ringed.
      if (picking.kind !== "point" || picking.plateId !== plateId) return null
      const snapped = this.hoverPick?.target?.key
      return picking.targets.flatMap((target) => {
        const marker: Marker = { position: target.position, style: "target" }
        return target.key === snapped
          ? [marker, { ...marker, ring: true }]
          : [marker]
      })
    }
    if (!moving || selection?.plateId !== plateId) return null
    const view = this.host.view(plateId)
    if (!view) return null
    const pending =
      this.pending?.plateId === plateId ? this.pending.delta : null
    const delta = this.drag?.delta ?? pending ?? ZERO
    const snapped = this.drag?.snapped
    const rings = new Set(
      [this.from, this.hover, snapped?.own, snapped?.target].flatMap(
        (point) => point?.key ?? []
      )
    )
    return view.setupPoints().flatMap((point) => {
      const own = this.isOwn(point)
      const position = own ? plus(point.position, delta) : point.position
      const style = this.markerStyle(point, own)
      const marker = { position, style }
      return rings.has(point.key)
        ? [marker, { ...marker, ring: true }]
        : [marker]
    })
  }

  private refresh() {
    const { selection } = this.state
    for (const [plateId, view] of this.host.views()) {
      view.select(selection?.plateId === plateId ? selection.item : null)
      view.showMarkers(this.markersFor(plateId))
      view.showEdges(this.edgesFor(plateId))
    }
    this.host.invalidate()
  }

  /** The edges chosen so far and the one under the pointer, while edges are picked. */
  private edgesFor(plateId: string): EdgeHighlight[] | null {
    const { picking } = this.state
    const view = this.host.view(plateId)
    if (picking?.kind !== "edges" || picking.plateId !== plateId || !view)
      return null
    const hovered = this.hoverEdge
    const chosen = plateItemEdges(view.plate).filter(
      (edge) =>
        picking.edges.some((ref) => sameEdge(ref, edge.ref)) &&
        !(hovered && sameEdge(hovered.ref, edge.ref))
    )
    return [
      ...chosen.map(({ start, end }) => ({ start, end, hovered: false })),
      ...(hovered
        ? [{ start: hovered.start, end: hovered.end, hovered: true }]
        : []),
    ]
  }

  /** The edge of the picking plate nearest the pointer on screen, within reach. */
  private edgeAt(event: MouseEvent): ItemEdge | null {
    const { picking } = this.state
    if (picking?.kind !== "edges") return null
    const view = this.host.view(picking.plateId)
    if (!view) return null
    const rect = this.host.canvas.getBoundingClientRect()
    const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    let best: ItemEdge | null = null
    let nearest = EDGE_RADIUS
    for (const edge of plateItemEdges(view.plate)) {
      const distance = distanceToSegment(
        at,
        this.screen(picking.plateId, edge.start, rect),
        this.screen(picking.plateId, edge.end, rect)
      )
      if (distance < nearest) {
        best = edge
        nearest = distance
      }
    }
    return best
  }

  private setFrom(point: SetupPoint | null) {
    this.from = point
    this.reportPick({ from: point, notice: null })
    this.refresh()
  }

  /** Tells the owner about the picked point or a notice; an empty pick only once. */
  private reportPick(pick: ArrangePick) {
    const empty = !pick.from && !pick.notice
    if (empty && this.pickEmpty) return
    this.pickEmpty = empty
    this.events.pick(pick)
  }

  private hold(pointerId: number) {
    this.host.controls.enabled = false
    this.host.canvas.setPointerCapture(pointerId)
  }

  private release(pointerId: number) {
    this.host.controls.enabled = true
    if (this.host.canvas.hasPointerCapture(pointerId))
      this.host.canvas.releasePointerCapture(pointerId)
  }

  private cancelDrag() {
    const { drag } = this
    if (!drag) return
    this.drag = null
    this.release(drag.pointerId)
    this.host.view(drag.plateId)?.setPreview(drag.item, null)
    this.host.canvas.style.cursor = ""
    this.events.drag(null)
  }

  private cancelPress() {
    if (!this.press) return
    this.release(this.press.pointerId)
    this.press = null
  }

  /** A point on the screen, in CSS pixels from the canvas corner, with its depth. */
  private screen(plateId: string, point: Point3, rect: DOMRect) {
    const projected = this.projected
      .set(point[0] + this.host.offset(plateId), point[1], point[2])
      .project(this.host.camera)
    return {
      x: ((projected.x + 1) / 2) * rect.width,
      y: ((1 - projected.y) / 2) * rect.height,
      depth: projected.z,
    }
  }

  /** The point of the selected plate nearest the pointer in move mode, as `betterPick` weighs. */
  private pointAt(event: MouseEvent): SetupPoint | null {
    const { selection, moving, picking } = this.state
    const plateId = moving && !picking ? selection?.plateId : undefined
    if (!plateId) return null
    const view = this.host.view(plateId)
    if (!view) return null
    const rect = this.host.canvas.getBoundingClientRect()
    const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    let best: PointPick | null = null
    for (const point of view.setupPoints()) {
      const shown = this.screen(plateId, point.position, rect)
      const distance = Math.hypot(shown.x - at.x, shown.y - at.y)
      if (distance > PICK_RADIUS) continue
      const candidate = {
        point,
        distance,
        own: this.isOwn(point),
        depth: shown.depth,
      }
      if (betterPick(candidate, best)) best = candidate
    }
    return best?.point ?? null
  }

  /** Where the pointer is on the selected item; null when it is not on it. */
  private grabAt(event: MouseEvent): THREE.Vector3 | null {
    const selection = this.state.selection
    const hit = this.itemAt(event)
    if (
      !hit ||
      !selection ||
      hit.plateId !== selection.plateId ||
      !sameSetupItem(hit.item, selection.item)
    )
      return null
    return hit.grab
  }

  /** The design, when the pointer is on a plate's work origin axes; they draw over everything. */
  private designAt(event: MouseEvent): ItemUnderPointer | null {
    const rect = this.host.canvas.getBoundingClientRect()
    const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    let best: (ItemUnderPointer & { distance: number }) | null = null
    for (const [plateId, view] of this.host.views()) {
      const origin = view.plate.workOrigin
      const center = this.screen(plateId, origin, rect)
      const distance = Math.min(
        ...AXES.map((axis) => {
          const end = this.screen(
            plateId,
            [
              origin[0] + axis.x * WORK_AXIS_LENGTH,
              origin[1] + axis.y * WORK_AXIS_LENGTH,
              origin[2] + axis.z * WORK_AXIS_LENGTH,
            ],
            rect
          )
          return distanceToSegment(at, center, end)
        })
      )
      if (distance > DESIGN_RADIUS || (best && best.distance <= distance))
        continue
      best = {
        plateId,
        item: { kind: "design" },
        grab: new THREE.Vector3(
          origin[0] + this.host.offset(plateId),
          origin[1],
          origin[2]
        ),
        distance,
      }
    }
    return best
  }

  /**
   * What a click picks while a point is picked: the target nearest the pointer within the snap
   * radius, unless Alt is held, else the point of a shown surface of the plate (the bed, a
   * fixture, the stock) under it; null over neither.
   */
  private pickAt(event: MouseEvent): PickedPoint | null {
    const { picking } = this.state
    if (picking?.kind !== "point") return null
    const target = event.altKey
      ? null
      : this.targetAt(event, picking.plateId, picking.targets)
    if (target) return { position: target.position, target }
    const view = this.host.view(picking.plateId)
    if (!view) return null
    this.host.aim(event)
    const hit = view.itemHit(this.host.raycaster)
    if (!hit) return null
    const { x, y, z } = hit.point
    const position: Point3 = [
      millimetres(x - this.host.offset(picking.plateId)) + 0,
      millimetres(y) + 0,
      millimetres(z) + 0,
    ]
    return { position, target: null }
  }

  /**
   * The target nearest the pointer on screen, within the snap radius; of two within a pixel of
   * each other, the one nearer to the eye.
   */
  private targetAt(
    event: MouseEvent,
    plateId: string,
    targets: readonly PickTarget[]
  ): PickTarget | null {
    const rect = this.host.canvas.getBoundingClientRect()
    const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    let best: { target: PickTarget; distance: number; depth: number } | null =
      null
    for (const target of targets) {
      const shown = this.screen(plateId, target.position, rect)
      const distance = Math.hypot(shown.x - at.x, shown.y - at.y)
      if (distance > SNAP_RADIUS) continue
      const better =
        !best ||
        (Math.abs(distance - best.distance) > 1
          ? distance < best.distance
          : shown.depth < best.depth)
      if (better) best = { target, distance, depth: shown.depth }
    }
    return best?.target ?? null
  }

  /** The item under the pointer, the nearest along the picking ray. */
  private itemAt(event: MouseEvent): ItemUnderPointer | null {
    const design = this.designAt(event)
    if (design) return design
    this.host.aim(event)
    let best: (ItemUnderPointer & { distance: number }) | null = null
    for (const [plateId, view] of this.host.views()) {
      const hit = view.itemHit(this.host.raycaster)
      if (hit && (!best || hit.distance < best.distance))
        best = {
          plateId,
          item: hit.item,
          grab: hit.point,
          distance: hit.distance,
        }
    }
    return best
  }

  private hoverAt(event: PointerEvent) {
    if (this.state.picking) {
      this.pickHoverAt(event)
      return
    }
    // Move mode may have ended since the pointer moved.
    const { moving, selection } = this.state
    if (!moving || !selection) return
    const canvas = this.host.canvas
    const point = this.pointAt(event)
    if (point?.key !== this.hover?.key) {
      this.hover = point
      this.refresh()
    }
    if (point) {
      canvas.title = pointTitle(point)
      canvas.style.cursor = "pointer"
      return
    }
    canvas.removeAttribute("title")
    const hit = this.itemAt(event)
    const onSelected =
      !!hit &&
      hit.plateId === selection.plateId &&
      sameSetupItem(hit.item, selection.item)
    canvas.style.cursor = onSelected ? "grab" : ""
  }

  /**
   * What a click would pick: a point, labelled with where it is and the target it snapped to,
   * or an edge with its name.
   */
  private pickHoverAt(event: PointerEvent) {
    const { picking } = this.state
    if (!picking) return
    const canvas = this.host.canvas
    if (picking.kind === "point") {
      const pick = this.pickAt(event)
      const snapped = pick?.target?.key !== this.hoverPick?.target?.key
      this.hoverPick = pick
      this.host.label(
        pick && {
          plateId: picking.plateId,
          position: pick.position,
          text: pickedText(pick),
        }
      )
      if (snapped) this.refresh()
      canvas.style.cursor = pick?.target ? "pointer" : "crosshair"
      return
    }
    const edge = this.edgeAt(event)
    const changed =
      !edge || !this.hoverEdge
        ? edge !== this.hoverEdge
        : !sameEdge(edge.ref, this.hoverEdge.ref)
    if (changed) {
      this.hoverEdge = edge
      this.refresh()
    }
    if (edge) canvas.title = edge.label
    else canvas.removeAttribute("title")
    canvas.style.cursor = edge ? "pointer" : "crosshair"
  }

  /** Where the grabbed point goes: on the bed-parallel plane through it, or along one axis. */
  private constrained(drag: Drag) {
    const { ray } = this.host.raycaster
    const [x, y, z] = moveAxesMask(drag.axes)
    if (x && y)
      return ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -drag.grab.z),
        new THREE.Vector3()
      )
    if (x) return nearestOnLine(ray, drag.grab, AXES[0])
    if (y) return nearestOnLine(ray, drag.grab, AXES[1])
    if (z) return nearestOnLine(ray, drag.grab, AXES[2])
    return null
  }

  /** The nearest pair of a moving point and another point within the snap radius, if any. */
  private snapFor(drag: Drag, delta: Point3) {
    const rect = this.host.canvas.getBoundingClientRect()
    const mask = moveAxesMask(drag.axes)
    let best: Drag["snapped"] = null
    let nearest = SNAP_RADIUS
    for (const own of drag.own) {
      const moved = plus(own.position, delta)
      const at = this.screen(drag.plateId, moved, rect)
      for (const target of drag.targets) {
        const aligned = moved.map((value, axis) =>
          mask[axis] ? target.position[axis] : value
        ) as Point3
        const to = this.screen(drag.plateId, aligned, rect)
        const distance = Math.hypot(to.x - at.x, to.y - at.y)
        if (distance < nearest) {
          best = { own, target }
          nearest = distance
        }
      }
    }
    return best
  }

  private dragTo(event: PointerEvent, drag: Drag) {
    drag.moved ||=
      Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >
      CLICK_TOLERANCE
    if (!drag.moved) return
    this.host.aim(event)
    const target = this.constrained(drag)
    if (!target) return
    const raw: Point3 = [
      target.x - drag.grab.x,
      target.y - drag.grab.y,
      target.z - drag.grab.z,
    ]
    if (!raw.every(Number.isFinite)) return
    const snapped =
      this.state.snap && !event.altKey ? this.snapFor(drag, raw) : null
    drag.snapped = snapped
    drag.delta = snapped
      ? plus(
          raw,
          alignment(
            plus(snapped.own.position, raw),
            snapped.target.position,
            drag.axes
          )
        )
      : (raw.map(toStep) as Point3)
    this.host.view(drag.plateId)?.setPreview(drag.item, drag.delta)
    this.events.drag({
      delta: drag.delta,
      snappedTo: snapped ? snapped.target.label : null,
    })
    this.refresh()
  }

  private clickPoint(point: SetupPoint) {
    const selection = this.state.selection
    if (!selection || !this.state.moving) return
    if (this.isOwn(point)) {
      this.setFrom(this.from?.key === point.key ? null : point)
      return
    }
    if (!this.from) {
      this.reportPick({ from: null, notice: "pick-own-point" })
      return
    }
    this.commit(
      selection.plateId,
      selection.item,
      alignment(this.from.position, point.position, this.state.axes)
    )
  }

  /** Shows the move at once and hands it on; a refused move springs back. */
  private commit(plateId: string, item: SetupItemRef, delta: Point3) {
    if (this.from) this.setFrom(null)
    if (isZero(delta)) return
    const view = this.host.view(plateId)
    view?.setPreview(item, delta)
    this.pending = { plateId, plate: view?.plate, delta }
    if (!this.events.move(plateId, item, delta)) {
      this.pending = null
      view?.setPreview(item, null)
    }
    this.refresh()
  }

  private openMenu(event: PointerEvent) {
    const { selection, moving } = this.state
    const point = moving && this.from ? this.pointAt(event) : null
    const from = this.from
    const offered =
      from && point && !this.isOwn(point) ? { from, to: point } : null
    if (!offered) {
      const hit = this.itemAt(event)
      const selected =
        !!hit &&
        !!selection &&
        hit.plateId === selection.plateId &&
        sameSetupItem(hit.item, selection.item)
      if (hit && !selected) this.events.select(hit.plateId, hit.item)
    }
    this.events.menu({ x: event.clientX, y: event.clientY, alignment: offered })
  }
}
