import type { MachineBed } from "@/domain/fixtures/machine-bed"
import { setupPoints } from "@/domain/plate/setup-items"
import type { SetupPoint, SetupSubject } from "@/domain/plate/setup-items"
import type { Point3 } from "@/domain/nc/gcode"
import type { Stock } from "@/domain/stock/stock"
import {
  fixtureBounds,
  fixtureSupportHeight,
} from "@/domain/fixtures/definitions"
import {
  getProbeTouches,
  getProbingPreview,
  registerProbeGrid,
  registerProbeTouch,
} from "@/domain/probing/registration"
import type { ProbeGrid, ProbeTouch } from "@/domain/probing/registration"
import { kitForSetup } from "@/domain/fixtures/catalog"
import type {
  ViewerPlate,
  ViewerProblem,
  ViewerProblemRef,
} from "@/components/workspace/viewer/viewer-input"
import { ANCHOR_LIMIT } from "@/domain/anchors/stored-anchors"
import { COORDINATE_LIMIT } from "@/domain/primitives"

export type ViewerBounds = { min: Point3; max: Point3 }
export type LineRange = { start: number; end: number }
export type PlatePlacement = {
  id: string
  index: number
  offsetX: number
  bounds: ViewerBounds
  label: Point3
}
const PLATE_GAP = 56
export const PATH_DISPLAY_LIFT = 0.6
export const WORK_AXIS_LENGTH = 16
export const WORK_AXIS_LABEL_DISTANCE = 20
export const WORK_AXIS_LABEL_SIZE = 6
export const STORED_ANCHOR_RADIUS = 2
export const ANCHOR_DISPLAY_LIFT = 0.8
/** The playback marker for a tool without a shape stands this tall above the path's end. */
export const TOOL_MARKER_LENGTH = 22
/** The viewer draws this much around a machine's bed, its reference grid this far below it. */
const BED_MARGIN = 7
const GRID_DROP = 0.8
/** Plate labels stand this far in front of the drawn bed. */
const LABEL_GAP = 18
/** Room above an empty bed, so it is framed like a plate. */
const EMPTY_HEADROOM = 30

/** A problem's marker, by its plate and key. */
export const problemMarkerId = ({ plateId, key }: ViewerProblemRef) =>
  `${plateId}\n${key}`

/**
 * Where a problem's marker stands on its plate's bed: at its first place's point, a path's
 * middle point, or the middle of an area's top.
 */
export function problemAnchor({ places: [place] }: ViewerProblem): Point3 {
  switch (place.kind) {
    case "point":
      return place.at
    case "path":
      return place.points[Math.floor(place.points.length / 2)]
    case "area":
      return [
        (place.min[0] + place.max[0]) / 2,
        (place.min[1] + place.max[1]) / 2,
        Math.max(place.min[2], place.max[2]),
      ]
  }
}

/** Inclusive source-line selection test in the original 1-based numbering. */
export function lineInRanges(line: number, ranges: readonly LineRange[]) {
  return ranges.some((range) => line >= range.start && line <= range.end)
}

export function plateStockBounds(plate: ViewerPlate): ViewerBounds | null {
  if (!plate.stock) return null
  const { stockAnchor } = plate
  return {
    min: [...stockAnchor],
    max: [
      stockAnchor[0] + plate.stock.width,
      stockAnchor[1] + plate.stock.depth,
      stockAnchor[2] + plate.stock.height,
    ],
  }
}

/** The kit of the machine a viewer plate is set up for: its bed and its probe (`kitForSetup`). */
export const plateKit = (plate: Pick<ViewerPlate, "deviceId" | "fixtures">) =>
  kitForSetup({ deviceId: plate.deviceId, fixtures: plate.fixtures ?? [] })

/** The grids a plate's program probes, as its machine's probe reads them, on the bed. */
export function plateProbeGrids(
  plate: Pick<ViewerPlate, "program" | "anchorSetup" | "deviceId" | "fixtures">
): ProbeGrid[] {
  return getProbingPreview(plate.program, plateKit(plate).probe)
    .grids.map((grid) => registerProbeGrid(grid, plate.anchorSetup))
    .filter((grid): grid is ProbeGrid => grid !== null)
}

/** Where a plate's touch-offs touch, registered on the bed as its probe grids are. */
export function plateProbeTouches(
  plate: Pick<ViewerPlate, "program" | "anchorSetup" | "deviceId" | "fixtures">
): ProbeTouch[] {
  return getProbeTouches(plate.program, plateKit(plate).probe)
    .map((touch) => registerProbeTouch(touch, plate.anchorSetup))
    .filter((touch): touch is ProbeTouch => touch !== null)
}

/** Device anchor positions stay in bed coordinates, independent of stock and NC zero. */
export function plateAnchorPoints(
  plate: Pick<ViewerPlate, "storedAnchors" | "fixtures">
) {
  const z = fixtureSupportHeight(plate.fixtures)
  return (plate.storedAnchors ?? [])
    .slice(0, ANCHOR_LIMIT)
    .filter((anchor) =>
      anchor.position.every(
        (value) => Number.isFinite(value) && Math.abs(value) <= COORDINATE_LIMIT
      )
    )
    .map((anchor) => ({
      ...anchor,
      point: [anchor.position[0], anchor.position[1], z] as Point3,
    }))
}

/** The setup a viewer plate draws, as setup items read it. */
const viewerSetup = (plate: ViewerPlate): SetupSubject => ({
  stock: plate.stock,
  stockAnchor: plate.stockAnchor,
  workOrigin: plate.workOrigin,
  fixtures: plate.fixtures,
  anchors: plate.anchorSetup,
  deviceId: plate.deviceId,
})

const pointLists = new WeakMap<ViewerPlate, SetupPoint[]>()

/** Every point a move on this plate can line up by; plates are immutable snapshots. */
export function plateSetupPoints(plate: ViewerPlate): SetupPoint[] {
  const cached = pointLists.get(plate)
  if (cached) return cached
  const points = setupPoints(viewerSetup(plate), plate.toolpathBounds)
  pointLists.set(plate, points)
  return points
}

/** What the viewer draws of a machine's bed: the bed with a margin, down to its reference grid. */
export function bedArea({ bounds: { min, max } }: MachineBed): ViewerBounds {
  return {
    min: [min[0] - BED_MARGIN, min[1] - BED_MARGIN, min[2] - GRID_DROP],
    max: [max[0] + BED_MARGIN, max[1] + BED_MARGIN, max[2]],
  }
}

const envelopes = new WeakMap<ViewerPlate, ViewerBounds>()

/** Unplaced bed, setup and path envelope, including outlying moves; plates are immutable snapshots. */
function plateEnvelope(plate: ViewerPlate, area: ViewerBounds): ViewerBounds {
  const cached = envelopes.get(plate)
  if (cached) return cached
  const { stockAnchor, workOrigin: origin } = plate
  const local: ViewerBounds = { min: [...area.min], max: [...area.max] }
  const axisExtent = WORK_AXIS_LABEL_DISTANCE + WORK_AXIS_LABEL_SIZE / 2
  for (const axis of [0, 1, 2] as const) {
    local.min[axis] = Math.min(local.min[axis], stockAnchor[axis], origin[axis])
    local.max[axis] = Math.max(
      local.max[axis],
      stockAnchor[axis],
      origin[axis] + axisExtent
    )
  }
  const fixtureBoxes = [
    ...(plate.fixtures ?? []).map(fixtureBounds),
    plateStockBounds(plate),
  ]
  for (const { point } of plateAnchorPoints(plate)) {
    for (const axis of [0, 1] as const) {
      local.min[axis] = Math.min(
        local.min[axis],
        point[axis] - STORED_ANCHOR_RADIUS
      )
      local.max[axis] = Math.max(
        local.max[axis],
        point[axis] + STORED_ANCHOR_RADIUS
      )
    }
    local.min[2] = Math.min(local.min[2], point[2])
    local.max[2] = Math.max(local.max[2], point[2] + ANCHOR_DISPLAY_LIFT)
  }
  for (const box of fixtureBoxes)
    if (box)
      for (const axis of [0, 1, 2] as const) {
        local.min[axis] = Math.min(local.min[axis], box.min[axis])
        local.max[axis] = Math.max(local.max[axis], box.max[axis])
      }
  // The whole path, including outlying moves, is drawn from the plate's work origin, with
  // room above it for the tallest tool playback shows.
  if (plate.machineProgram.segments.length) {
    const { min, max } = plate.machineProgram.bounds
    const tool = Math.max(
      TOOL_MARKER_LENGTH,
      ...plate.tools.map((run) => run.shape?.length ?? 0)
    )
    for (const axis of [0, 1, 2] as const) {
      local.min[axis] = Math.min(local.min[axis], min[axis] + origin[axis])
      local.max[axis] = Math.max(
        local.max[axis],
        max[axis] + origin[axis] + (axis === 2 ? tool + PATH_DISPLAY_LIFT : 0)
      )
    }
  }
  for (const grid of plateProbeGrids(plate)) {
    const { outline } = probeGridVertices(grid, plate.stock, plate)
    for (const point of outline)
      for (const axis of [0, 1, 2] as const) {
        local.min[axis] = Math.min(local.min[axis], point[axis])
        local.max[axis] = Math.max(
          local.max[axis],
          point[axis] + (axis === 2 ? PATH_DISPLAY_LIFT : 0)
        )
      }
  }
  envelopes.set(plate, local)
  return local
}

/**
 * Pack plate envelopes in array order, each on its machine's bed. Without plates, the layout
 * frames the `empty` bed.
 */
export function layoutPlates(
  plates: readonly ViewerPlate[],
  empty: MachineBed
) {
  /** Where the next envelope starts; the first starts at its own bed's left edge. */
  let cursor: number | null = null
  const bounds: ViewerBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  }
  const placements = plates.map((plate, index): PlatePlacement => {
    const area = bedArea(plateKit(plate).bed)
    const local = plateEnvelope(plate, area)
    const offsetX = (cursor ?? area.min[0]) - local.min[0]
    const placed: ViewerBounds = {
      min: [local.min[0] + offsetX, local.min[1], local.min[2]],
      max: [local.max[0] + offsetX, local.max[1], local.max[2]],
    }
    const label: Point3 = [
      (area.min[0] + area.max[0]) / 2 + offsetX,
      area.min[1] - LABEL_GAP,
      area.max[2],
    ]
    for (const axis of [0, 1, 2] as const) {
      bounds.min[axis] = Math.min(
        bounds.min[axis],
        placed.min[axis],
        label[axis]
      )
      bounds.max[axis] = Math.max(
        bounds.max[axis],
        placed.max[axis],
        label[axis]
      )
    }
    cursor = placed.max[0] + PLATE_GAP
    return { id: plate.id, index, offsetX, bounds: placed, label }
  })
  if (!plates.length) {
    const area = bedArea(empty)
    bounds.min = [area.min[0], area.min[1] - LABEL_GAP, area.min[2]]
    bounds.max = [area.max[0], area.max[1], area.max[2] + EMPTY_HEADROOM]
  }
  return { placements, bounds }
}

/** Orthographic projection of all eight bounds corners onto the camera basis. */
export function fitOrthographicBounds(
  bounds: ViewerBounds,
  right: Point3,
  up: Point3,
  aspect: number,
  padding = 1.2
) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1
  const half = bounds.min.map((value, axis) => (bounds.max[axis] - value) / 2)
  const extent = (basis: Point3) =>
    half.reduce((sum, value, axis) => sum + value * Math.abs(basis[axis]), 0)
  const halfHeight =
    Math.max(1, extent(up), extent(right) / safeAspect) * Math.max(1, padding)
  return {
    left: -halfHeight * safeAspect,
    right: halfHeight * safeAspect,
    top: halfHeight,
    bottom: -halfHeight,
  }
}

/**
 * XY diagram on the current setup's nominal surface; the probe's moves over it are the
 * machine program's.
 */
export function probeGridVertices(
  grid: ProbeGrid,
  stock: Stock | null,
  { stockAnchor, workOrigin }: Pick<ViewerPlate, "stockAnchor" | "workOrigin">
) {
  if (grid.coordinateMode === "machine")
    throw new Error(
      "Register machine probe coordinates before rendering the grid."
    )
  const origin: Point3 = [
    grid.coordinateMode === "bed" ? 0 : workOrigin[0],
    grid.coordinateMode === "bed" ? 0 : workOrigin[1],
    stock ? stockAnchor[2] + stock.height : workOrigin[2],
  ]
  const point = (x: number, y: number): Point3 => [
    origin[0] + x,
    origin[1] + y,
    origin[2],
  ]
  const [x, y] = grid.start
  const points = grid.points.map(([px, py]) => point(px, py))
  const outline = [
    point(x, y),
    point(x + grid.width, y),
    point(x + grid.width, y + grid.depth),
    point(x, y + grid.depth),
    point(x, y),
  ]
  const lines: number[] = []
  for (let column = 0; column < grid.columns; column++) {
    const px = x + (grid.width * column) / (grid.columns - 1)
    lines.push(...point(px, y), ...point(px, y + grid.depth))
  }
  for (let row = 0; row < grid.rows; row++) {
    const py = y + (grid.depth * row) / (grid.rows - 1)
    lines.push(...point(x, py), ...point(x + grid.width, py))
  }
  return { origin, points, outline, lines }
}

/** Where a touch-off touches, on the surface its plate's probe grids lie on. */
export function probeTouchPoint(
  touch: ProbeTouch,
  stock: Stock | null,
  { stockAnchor, workOrigin }: Pick<ViewerPlate, "stockAnchor" | "workOrigin">
): Point3 {
  if (touch.coordinateMode === "machine")
    throw new Error(
      "Register machine probe coordinates before rendering the touch."
    )
  const relative = touch.coordinateMode !== "bed"
  const [x, y] = touch.point
  return [
    (relative ? workOrigin[0] : 0) + x,
    (relative ? workOrigin[1] : 0) + y,
    stock ? stockAnchor[2] + stock.height : workOrigin[2],
  ]
}
