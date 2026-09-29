import * as THREE from "three"
import { cuts as isCut } from "@/domain/compile/toolpath-bounds"
import { isProbeSlot } from "@/domain/tools/tool-table"
import type { GCodeProgram, GCodeSegment } from "@/domain/nc/gcode"
import type { LineRange } from "../bed-viewer-layout"

/** How a segment is drawn: cutting, travel, or the probe's path and probing. */
export type Motion = "cut" | "rapid" | "probe"
export const MOTIONS: readonly Motion[] = ["cut", "rapid", "probe"]

/** The probes' moves and every probing touch draw apart from cuts and travel. */
export function motionOf(segment: GCodeSegment): Motion {
  if (isProbeSlot(segment.tool) || segment.probing) return "probe"
  return isCut(segment) ? "cut" : "rapid"
}

/** Program segment indices [first, last). */
export type SegmentWindow = { first: number; last: number }

/**
 * One program's segment endpoints in work coordinates, split by motion while
 * keeping source order, so any revealed prefix is a prefix of each buffer.
 */
export type ToolpathBuffers = {
  /** Two XYZ vertices per segment of that motion. */
  readonly vertices: Readonly<Record<Motion, Float32Array>>
  /** Shared and read-only: culling and draw-order bounds of each motion's vertices. */
  readonly bounds: Readonly<Record<Motion, THREE.Box3>>
  /** Cutting and probe segments among the first `index` program segments. */
  readonly before: Readonly<Record<Exclude<Motion, "rapid">, Uint32Array>>
}

const cache = new WeakMap<GCodeProgram, ToolpathBuffers>()

/** Built once per parsed program; programs are immutable snapshots. */
export function toolpathBuffers(program: GCodeProgram): ToolpathBuffers {
  const cached = cache.get(program)
  if (cached) return cached
  const { segments } = program
  const before = {
    cut: new Uint32Array(segments.length + 1),
    probe: new Uint32Array(segments.length + 1),
  }
  const motions = segments.map(motionOf)
  motions.forEach((motion, index) => {
    before.cut[index + 1] = before.cut[index] + (motion === "cut" ? 1 : 0)
    before.probe[index + 1] = before.probe[index] + (motion === "probe" ? 1 : 0)
  })
  const counts: Record<Motion, number> = {
    cut: before.cut[segments.length],
    probe: before.probe[segments.length],
    rapid:
      segments.length -
      before.cut[segments.length] -
      before.probe[segments.length],
  }
  const vertices: Record<Motion, Float32Array> = {
    cut: new Float32Array(counts.cut * 6),
    rapid: new Float32Array(counts.rapid * 6),
    probe: new Float32Array(counts.probe * 6),
  }
  const written: Record<Motion, number> = { cut: 0, rapid: 0, probe: 0 }
  segments.forEach((segment, index) => {
    const motion = motions[index]
    vertices[motion].set(segment.start, written[motion])
    vertices[motion].set(segment.end, written[motion] + 3)
    written[motion] += 6
  })
  const bounds: Record<Motion, THREE.Box3> = {
    cut: new THREE.Box3().setFromArray(vertices.cut),
    rapid: new THREE.Box3().setFromArray(vertices.rapid),
    probe: new THREE.Box3().setFromArray(vertices.probe),
  }
  const buffers = { vertices, bounds, before }
  cache.set(program, buffers)
  return buffers
}

/** Segments of one motion among the first `index` program segments. */
export function motionSegmentsBefore(
  buffers: ToolpathBuffers,
  motion: Motion,
  index: number
) {
  const { cut, probe } = buffers.before
  if (motion === "rapid") return index - cut[index] - probe[index]
  return buffers.before[motion][index]
}

/** First segment whose source line satisfies `reached`; parsed lines never decrease. */
function firstSegment(
  program: GCodeProgram,
  reached: (line: number) => boolean
) {
  let low = 0
  let high = program.segments.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (reached(program.segments[middle].line)) high = middle
    else low = middle + 1
  }
  return low
}

/** Number of segments at or before an inclusive source line. */
function segmentsThroughLine(program: GCodeProgram, line: number) {
  return firstSegment(program, (value) => !(value <= line))
}

/**
 * Segments through the touch of a probe grid's sample on its line, so the probe shows where it
 * probes; null when no probing move belongs to that sample.
 */
function segmentsThroughProbePoint(
  program: GCodeProgram,
  line: number,
  probePoint: number
) {
  const { segments } = program
  let end: number | null = null
  for (
    let index = firstSegment(program, (value) => value >= line);
    index < segments.length && segments[index].line === line;
    index++
  ) {
    // Moves before the grid's own, such as changing to the probe, come with its first sample.
    const point = segments[index].probePoint ?? 0
    if (point > probePoint) break
    if (point === probePoint && segments[index].probing) end = index + 1
  }
  return end
}

/**
 * Revealed segment count; a preview line takes precedence over percentage progress, and on a
 * probe grid's line its sample does.
 */
export function revealedSegments(
  program: GCodeProgram,
  progress: number,
  previewLine?: number | null,
  previewProbePoint?: number | null
) {
  if (previewLine !== undefined && previewLine !== null) {
    if (
      previewProbePoint !== undefined &&
      previewProbePoint !== null &&
      Number.isFinite(previewProbePoint)
    ) {
      const probed = segmentsThroughProbePoint(
        program,
        previewLine,
        Math.floor(previewProbePoint)
      )
      if (probed !== null) return probed
    }
    return segmentsThroughLine(program, previewLine)
  }
  const total = program.segments.length
  const percent = Number.isFinite(progress) ? progress : 0
  return Math.min(total, Math.max(0, Math.ceil((total * percent) / 100)))
}

/** Inclusive source ranges as ascending, disjoint segment windows. */
export function segmentWindows(
  program: GCodeProgram,
  ranges: readonly LineRange[]
) {
  const windows = ranges
    .map((range) => ({
      first: firstSegment(program, (value) => value >= range.start),
      last: segmentsThroughLine(program, range.end),
    }))
    .filter((window) => window.first < window.last)
    .sort((a, b) => a.first - b.first)
  const merged: SegmentWindow[] = []
  for (const window of windows) {
    const previous = merged.at(-1)
    if (previous && window.first <= previous.last)
      previous.last = Math.max(previous.last, window.last)
    else merged.push(window)
  }
  return merged
}
