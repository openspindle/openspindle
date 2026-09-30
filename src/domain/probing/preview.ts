import type { GCodeProgram } from "../nc/gcode"
import { isStoredAnchorSetup, machineToBed } from "../anchors/stored-anchors"
import type { StoredAnchorSetup } from "../anchors/stored-anchors"
import type { Frame, Vec2, XY } from "../geometry/frame"
import { boundsOf } from "../geometry/rect"
import type { Rect } from "../geometry/rect"
import { offering } from "./probe"
import type { GridProbing, ProbeTool } from "./probe"

/**
 * The frames previews place probing in: relative to where the probe starts, as NC places it
 * until it moves the probe in machine coordinates; the machine's own (G53); and the bed's, where
 * registration puts the machine's.
 */
export type PreviewFrame = Exclude<Frame, "work">

/** Where the probe is, in one of the frames `TFrame`, marked with it. */
export type ProbeAt<TFrame extends PreviewFrame = PreviewFrame> = {
  [TKey in TFrame]: { readonly frame: TKey; readonly at: XY<TKey> }
}[TFrame]

/** Where the probe starts, before NC moves it in machine coordinates: its own frame's origin. */
export const PROBE_START: ProbeAt<"probe"> = { frame: "probe", at: [0, 0] }

/**
 * A planned rectangular probe grid, in one of the frames `TFrame`: XY samples only, never
 * measured heights.
 */
export type ProbeGrid<TFrame extends PreviewFrame = PreviewFrame> = {
  [TKey in TFrame]: {
    /** One-based line of the probing block in its NC source. */
    readonly sourceLine: number
    readonly frame: TKey
    /** Its first sample. */
    readonly start: XY<TKey>
    /** Its extent from the start, negative along an axis it runs back on. */
    readonly size: Vec2
    /** Its samples along each axis, both edges included. */
    readonly points: Vec2
    /** In the order the machine's probe visits them (`GridProbing.samples`). */
    readonly samples: readonly XY<TKey>[]
    /**
     * How high above its first touch the probe moves between samples (the firmware's H); null
     * when the NC leaves it to the firmware.
     */
    readonly clearance: number | null
  }
}[TFrame]

/**
 * A planned touch-off, in one of the frames `TFrame`: where the probe touches the stock top,
 * never a measured height.
 */
export type ProbeTouch<TFrame extends PreviewFrame = PreviewFrame> =
  ProbeAt<TFrame> & {
    /** One-based line of its first touch in its NC source. */
    readonly sourceLine: number
  }

/** The grids a program probes and how many samples they have in all. */
export type ProbingPreview = {
  readonly grids: readonly ProbeGrid<"probe" | "machine">[]
  readonly pointCount: number
  /** Around every grid's samples, whichever frame each is in; null without samples. */
  readonly bounds: Rect<"probe" | "machine"> | null
}
const NO_PROBING: ProbingPreview = { grids: [], pointCount: 0, bounds: null }
const caches = new WeakMap<
  GridProbing,
  WeakMap<GCodeProgram, ProbingPreview>
>()

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
  const samples = grids.flatMap<XY<"probe" | "machine">>((grid) => grid.samples)
  const result: ProbingPreview = {
    grids,
    pointCount: samples.length,
    bounds: boundsOf(samples),
  }
  cache.set(program, result)
  return result
}

/** Per machine's probes, which say both the touch-off and the grids it reads touches after. */
const touchCaches = new WeakMap<
  readonly ProbeTool[],
  WeakMap<GCodeProgram, ProbeTouch<"probe" | "machine">[]>
>()

/**
 * Where a program's touch-offs touch, as the machine's probe that touches off reads its NC
 * (`TouchOff.touches`): planned XY only, never measured heights. Nothing without one.
 */
export function getProbeTouches(
  program: GCodeProgram,
  probes: readonly ProbeTool[]
): ProbeTouch<"probe" | "machine">[] {
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
): ProbeTouch<"probe" | "bed"> | null {
  if (touch.frame !== "machine") return touch
  if (!isStoredAnchorSetup(setup)) return null
  return { ...touch, frame: "bed", at: machineToBed(setup)(touch.at) }
}

/** Resolve source-derived machine XY through the portable device/bed registration. */
export function registerProbeGrid(
  grid: ProbeGrid,
  setup?: StoredAnchorSetup
): ProbeGrid<"probe" | "bed"> | null {
  if (grid.frame !== "machine") return grid
  if (!isStoredAnchorSetup(setup)) return null
  const toBed = machineToBed(setup)
  return {
    ...grid,
    frame: "bed",
    start: toBed(grid.start),
    samples: grid.samples.map(toBed),
  }
}

/** Preview cursor only: revealed samples are planned steps, never completed measurements. */
export function probeGridProgress(
  grid: ProbeGrid,
  previewLine?: number | null,
  previewProbePoint?: number | null,
  progress = 100
) {
  const count = grid.samples.length
  if (previewLine !== undefined && previewLine !== null) {
    if (!Number.isFinite(previewLine))
      return { revealedCount: 0, activePoint: null }
    if (previewLine < grid.sourceLine)
      return { revealedCount: 0, activePoint: null }
    if (previewLine > grid.sourceLine)
      return { revealedCount: count, activePoint: null }
    const activePoint =
      previewProbePoint === undefined ||
      previewProbePoint === null ||
      !Number.isFinite(previewProbePoint)
        ? count - 1
        : Math.max(0, Math.min(count - 1, Math.floor(previewProbePoint)))
    return { revealedCount: activePoint + 1, activePoint }
  }
  const revealedCount = Math.max(
    0,
    Math.min(
      count,
      Math.ceil((count * (Number.isFinite(progress) ? progress : 0)) / 100)
    )
  )
  return {
    revealedCount,
    activePoint:
      revealedCount && revealedCount < count ? revealedCount - 1 : null,
  }
}
