import type { GCodeProgram } from "../nc/gcode"
import { isStoredAnchorSetup, machineToBed } from "../anchors/stored-anchors"
import type { StoredAnchorSetup } from "../anchors/stored-anchors"
import type { ProbeGrid, ProbePoint } from "@/domain/auto-level/probe-grid"
import type { ProbeTouch } from "@/domain/auto-z-height/probe-touch"
import { offering } from "@/domain/probing/probe"
import type { GridProbing, ProbeTool } from "@/domain/probing/probe"

export type { ProbeGrid, ProbePoint, ProbeTouch }
export type ProbingPreview = {
  grids: ProbeGrid[]
  pointCount: number
  bounds: { min: ProbePoint; max: ProbePoint } | null
}
const NO_PROBING: ProbingPreview = { grids: [], pointCount: 0, bounds: null }
const caches = new WeakMap<GridProbing, WeakMap<GCodeProgram, ProbingPreview>>()

/**
 * The grids a program probes, as the machine's probe that probes grids reads its NC
 * (`GridProbing.grids`): planned XY samples only, never measured heights. Nothing without one.
 */
export function getProbingPreview(
  program: GCodeProgram,
  probes: readonly ProbeTool[]
): ProbingPreview {
  const probing = offering(probes, "grid")?.capability
  if (!probing) return NO_PROBING
  let cache = caches.get(probing)
  if (!cache) caches.set(probing, (cache = new WeakMap()))
  const saved = cache.get(program)
  if (saved) return saved
  const grids = probing.grids(program)
  let pointCount = 0
  const minimum: ProbePoint = [Infinity, Infinity]
  const maximum: ProbePoint = [-Infinity, -Infinity]
  for (const grid of grids) {
    for (const point of grid.points)
      for (const axis of [0, 1] as const) {
        minimum[axis] = Math.min(minimum[axis], point[axis])
        maximum[axis] = Math.max(maximum[axis], point[axis])
      }
    pointCount += grid.pointCount
  }
  const result: ProbingPreview = {
    grids,
    pointCount,
    bounds: pointCount ? { min: minimum, max: maximum } : null,
  }
  cache.set(program, result)
  return result
}

/** Per machine's probes, which say both the touch-off and the grids it reads touches after. */
const touchCaches = new WeakMap<
  readonly ProbeTool[],
  WeakMap<GCodeProgram, ProbeTouch[]>
>()

/**
 * Where a program's touch-offs touch, as the machine's probe that touches off reads its NC
 * (`TouchOff.touches`): planned XY only, never measured heights. Nothing without one.
 */
export function getProbeTouches(
  program: GCodeProgram,
  probes: readonly ProbeTool[]
): ProbeTouch[] {
  const touchOff = offering(probes, "touch-off")?.capability
  if (!touchOff) return []
  let cache = touchCaches.get(probes)
  if (!cache) touchCaches.set(probes, (cache = new WeakMap()))
  const saved = cache.get(program)
  if (saved) return saved
  const touches = touchOff.touches(
    program,
    getProbingPreview(program, probes).grids
  )
  cache.set(program, touches)
  return touches
}

/** A touch-off's machine XY on the bed, through the device/bed registration grids use. */
export function registerProbeTouch(
  touch: ProbeTouch,
  setup?: StoredAnchorSetup
): ProbeTouch | null {
  if (touch.coordinateMode !== "machine") return touch
  if (!isStoredAnchorSetup(setup)) return null
  return {
    ...touch,
    coordinateMode: "bed",
    point: [...machineToBed(setup)(touch.point)] as ProbePoint,
  }
}

/** Resolve source-derived machine XY through the portable device/bed registration. */
export function registerProbeGrid(
  grid: ProbeGrid,
  setup?: StoredAnchorSetup
): ProbeGrid | null {
  if (grid.coordinateMode !== "machine") return grid
  if (!isStoredAnchorSetup(setup)) return null
  const toBed = machineToBed(setup)
  const point = (xy: ProbePoint) => [...toBed(xy)] as ProbePoint
  return {
    ...grid,
    coordinateMode: "bed",
    start: point(grid.start),
    points: grid.points.map(point),
  }
}

/** Preview cursor only: revealed samples are planned steps, never completed measurements. */
export function probeGridProgress(
  grid: ProbeGrid,
  previewLine?: number | null,
  previewProbePoint?: number | null,
  progress = 100
) {
  if (previewLine !== undefined && previewLine !== null) {
    if (!Number.isFinite(previewLine))
      return { revealedCount: 0, activePoint: null }
    if (previewLine < grid.sourceLine)
      return { revealedCount: 0, activePoint: null }
    if (previewLine > grid.sourceLine)
      return { revealedCount: grid.pointCount, activePoint: null }
    const activePoint =
      previewProbePoint === undefined ||
      previewProbePoint === null ||
      !Number.isFinite(previewProbePoint)
        ? grid.pointCount - 1
        : Math.max(
            0,
            Math.min(grid.pointCount - 1, Math.floor(previewProbePoint))
          )
    return { revealedCount: activePoint + 1, activePoint }
  }
  const revealedCount = Math.max(
    0,
    Math.min(
      grid.pointCount,
      Math.ceil(
        (grid.pointCount * (Number.isFinite(progress) ? progress : 0)) / 100
      )
    )
  )
  return {
    revealedCount,
    activePoint:
      revealedCount && revealedCount < grid.pointCount
        ? revealedCount - 1
        : null,
  }
}
