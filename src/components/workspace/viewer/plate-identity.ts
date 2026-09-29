import type { Point3 } from "@/domain/nc/gcode"
import type {
  StoredAnchor,
  ViewerPlate,
  ViewerProblem,
  ViewerToolRun,
} from "@/components/workspace/viewer/viewer-input"
import type { LineRange } from "../bed-viewer-layout"

export type Equality<T> = (a: T, b: T) => boolean
/** One equality per property, so adding a property forces a decision on how it compares. */
export type FieldEquality<T> = { [TKey in keyof T]-?: Equality<T[TKey]> }

export function sameFields<T extends object>(
  equality: FieldEquality<T>,
  a: T,
  b: T,
  keys: ReadonlyArray<keyof T> = Object.keys(equality) as Array<keyof T>
) {
  return a === b || keys.every((key) => equality[key](a[key], b[key]))
}

function sameList<T>(same: Equality<T>): Equality<readonly T[] | undefined> {
  return (a, b) =>
    a === b ||
    (!!a &&
      !!b &&
      a.length === b.length &&
      a.every((item, index) => same(item, b[index])))
}

function samePoint(a: Point3, b: Point3) {
  return a === b || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2])
}

function sameBounds(
  a: ViewerPlate["toolpathBounds"],
  b: ViewerPlate["toolpathBounds"]
) {
  return (
    a === b ||
    (!!a && !!b && samePoint(a.min, b.min) && samePoint(a.max, b.max))
  )
}

export const sameRanges = sameList<LineRange>(
  (a, b) => a.start === b.start && a.end === b.end
)

/** A problem's places come from its plate's cached diagnostics: unchanged, they are the same. */
export const sameProblems = sameList<ViewerProblem>(
  (a, b) =>
    a === b ||
    (a.plateId === b.plateId &&
      a.key === b.key &&
      a.severity === b.severity &&
      a.message === b.message &&
      a.places === b.places)
)

/** Shapes are cached per library tool, so an unchanged tool keeps its shape. */
const sameToolRuns = sameList<ViewerToolRun>(
  (a, b) =>
    a.lineStart === b.lineStart &&
    a.lineEnd === b.lineEnd &&
    a.segmentStart === b.segmentStart &&
    a.segmentEnd === b.segmentEnd &&
    a.tool === b.tool &&
    a.shape === b.shape &&
    a.model === b.model
)

/**
 * Hosts may re-wrap every plate on each render. Snapshots taken from the saved
 * plate compare by identity; arrays and points derived per render compare by value.
 */
const PLATE_EQUALITY: FieldEquality<ViewerPlate> = {
  id: Object.is,
  name: Object.is,
  program: Object.is,
  machineProgram: Object.is,
  tools: sameToolRuns,
  toolpathBounds: sameBounds,
  stock: Object.is,
  stockAnchor: samePoint,
  workOrigin: samePoint,
  storedAnchors: sameList<StoredAnchor>(
    (a, b) =>
      a.id === b.id &&
      a.name === b.name &&
      a.source === b.source &&
      a.position[0] === b.position[0] &&
      a.position[1] === b.position[1]
  ),
  anchorSetup: Object.is,
  fixtures: Object.is,
  deviceId: Object.is,
}

/** Whether two versions of a plate render identically, optionally for some fields only. */
export function samePlate(
  a: ViewerPlate,
  b: ViewerPlate,
  fields?: ReadonlyArray<keyof ViewerPlate>
) {
  return sameFields(PLATE_EQUALITY, a, b, fields)
}

/**
 * Keeps the previous object for every plate that renders identically, so
 * caches keyed by plate identity survive hosts that re-wrap unchanged plates.
 */
export function reconcilePlates(
  plates: readonly ViewerPlate[],
  previous: (id: string) => ViewerPlate | undefined
) {
  return plates.map((plate) => {
    const current = previous(plate.id)
    return current && samePlate(current, plate) ? current : plate
  })
}
