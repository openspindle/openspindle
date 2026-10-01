import type { GCodeProgram } from "../nc/gcode"
import { isStoredAnchorSetup, machineToBed } from "../anchors/stored-anchors"
import type { StoredAnchorSetup } from "../anchors/stored-anchors"
import type { Frame, Vec2, XY } from "../geometry/frame"
import type { MachineProbing } from "./strategy"

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
    /** In the order the probe visits them. */
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
}
const NO_PROBING: ProbingPreview = { grids: [], pointCount: 0 }

/** What a machine's readers read of each program, by the machine's readers. */
const caches = new WeakMap<
  MachineProbing["readers"],
  WeakMap<GCodeProgram, ProbingPreview>
>()

/**
 * The grids a program probes, as the machine's firmware reads its NC (`readers.grids`): planned
 * XY samples only, never measured heights. Nothing for a machine that does not probe.
 */
export function getProbingPreview(
  program: GCodeProgram,
  probing: MachineProbing | null
): ProbingPreview {
  if (!probing) return NO_PROBING
  const { readers } = probing
  let cache = caches.get(readers)
  if (!cache) caches.set(readers, (cache = new WeakMap()))
  const saved = cache.get(program)
  if (saved) return saved
  const grids = readers.grids(program)
  const result: ProbingPreview = {
    grids,
    pointCount: grids.reduce((count, grid) => count + grid.samples.length, 0),
  }
  cache.set(program, result)
  return result
}

/** Per machine's readers, which read both the touch-offs and the grids they follow. */
const touchCaches = new WeakMap<
  MachineProbing["readers"],
  WeakMap<GCodeProgram, ProbeTouch<"probe" | "machine">[]>
>()

/**
 * Where a program's touch-offs touch, as the machine's firmware reads its NC
 * (`readers.touches`): planned XY only, never measured heights. Nothing for a machine that does
 * not probe.
 */
export function getProbeTouches(
  program: GCodeProgram,
  probing: MachineProbing | null
): ProbeTouch<"probe" | "machine">[] {
  if (!probing) return []
  const { readers } = probing
  let cache = touchCaches.get(readers)
  if (!cache) touchCaches.set(readers, (cache = new WeakMap()))
  const saved = cache.get(program)
  if (saved) return saved
  const touches = readers.touches(
    program,
    getProbingPreview(program, probing).grids
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
