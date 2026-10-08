import { cuts } from "../compile/cutting-bounds"
import { parseGCode } from "../nc/gcode"
import type { GCodeProgram } from "../nc/gcode"
import type { Operation } from "./operation"

/** A position in program X and Y. */
export type PartPoint = readonly [x: number, y: number]

/**
 * One part of a program's toolpath, as pcb2gcode writes one per mask opening, hole or isolation
 * loop: the rapid that brings the tool over it, then its cuts, up to the retract after them.
 */
export type ToolpathPart = {
  /** Its place in the program, from 0. */
  readonly index: number
  /** Inclusive one-based lines: its approach, if a rapid in X or Y brings the tool there, through its last cut. */
  readonly startLine: number
  readonly endLine: number
  /** The X and Y bounds of its cuts, in program coordinates. */
  readonly min: PartPoint
  readonly max: PartPoint
  /** The middle of its bounds: where it is, which suppressing it keeps (`suppressedParts`). */
  readonly center: PartPoint
  /** Where its first cut starts: where its approach brings the tool. */
  readonly start: PartPoint
  /** The X and Y of its cuts' ends, two points (four numbers) per cut, in program coordinates. */
  readonly cuts: Float32Array
}

/** How far a suppressed part's kept middle may lie from a part of a toolpath generated again, mm. */
export const PART_MATCH_TOLERANCE = 0.5

const travelsXY = ({ start, end }: { start: number[]; end: number[] }) =>
  start[0] !== end[0] || start[1] !== end[1]

/**
 * A program's parts, in program order: each run of cuts between two rapids that reaches below
 * Z0. Lines between a part's approach and its last cut (feed words, dwells) are its own; its
 * retract and what follows are not, so leaving a part out leaves the tool where the part before
 * it retracted to.
 */
export function toolpathParts(program: GCodeProgram): ToolpathPart[] {
  const parts: ToolpathPart[] = []
  let approach: number | null = null
  let run: {
    startLine: number
    endLine: number
    start: PartPoint
    min: [number, number, number]
    max: [number, number, number]
    ends: number[]
  } | null = null
  const close = () => {
    if (!run || run.min[2] >= 0) return
    const { startLine, endLine, start, min, max, ends } = run
    parts.push({
      index: parts.length,
      startLine,
      endLine,
      min: [min[0], min[1]],
      max: [max[0], max[1]],
      center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
      start,
      cuts: Float32Array.from(ends),
    })
  }
  for (const segment of program.segments) {
    if (!cuts(segment)) {
      close()
      run = null
      // Only travel in X or Y brings the tool over a part; a retract does not.
      if (segment.rapid) approach = travelsXY(segment) ? segment.line : null
      continue
    }
    run ??= {
      startLine: approach ?? segment.line,
      endLine: segment.line,
      start: [segment.start[0], segment.start[1]],
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
      ends: [],
    }
    run.endLine = segment.line
    run.ends.push(
      segment.start[0],
      segment.start[1],
      segment.end[0],
      segment.end[1]
    )
    for (const point of [segment.start, segment.end])
      for (const axis of [0, 1, 2]) {
        run.min[axis] = Math.min(run.min[axis], point[axis])
        run.max[axis] = Math.max(run.max[axis], point[axis])
      }
  }
  close()
  return parts
}

/** Each kept NC's parts, by the source object that holds it. */
const partsOfSource = new WeakMap<object, readonly ToolpathPart[]>()

/**
 * The parts of an operation's toolpath, which can be suppressed one by one: a PCB operation's,
 * from its generated program; null for another operation or one still to generate.
 */
export function operationParts(
  operation: Operation
): readonly ToolpathPart[] | null {
  const { source } = operation
  if (source.kind !== "pcb" || source.nc === null) return null
  let parts = partsOfSource.get(source)
  if (!parts) {
    parts = toolpathParts(parseGCode(source.nc, operation.name))
    partsOfSource.set(source, parts)
  }
  return parts
}

/**
 * Which parts the kept points suppress: each point the part whose middle is nearest, within
 * `PART_MATCH_TOLERANCE`, so a point keeps its part when the toolpath is generated again (in
 * another order, or deeper with a wider cut). Points no part lies at are `unmatched`.
 */
export function matchParts(
  parts: readonly ToolpathPart[],
  points: readonly PartPoint[]
): { readonly matched: ReadonlySet<number>; readonly unmatched: PartPoint[] } {
  const matched = new Set<number>()
  const unmatched: PartPoint[] = []
  for (const point of points) {
    let nearest: ToolpathPart | null = null
    let distance = PART_MATCH_TOLERANCE
    for (const part of parts) {
      const away = Math.hypot(
        part.center[0] - point[0],
        part.center[1] - point[1]
      )
      if (away <= distance) {
        nearest = part
        distance = away
      }
    }
    if (nearest) matched.add(nearest.index)
    else unmatched.push(point)
  }
  return { matched, unmatched }
}

/** An operation's parts and which of them it suppresses; null for one without parts. */
export function suppressedParts(operation: Operation): {
  readonly parts: readonly ToolpathPart[]
  readonly matched: ReadonlySet<number>
  readonly unmatched: readonly PartPoint[]
} | null {
  const parts = operationParts(operation)
  if (!parts) return null
  return { parts, ...matchParts(parts, operation.suppressedParts ?? []) }
}

/** Where a part is kept while it is suppressed: its middle, to the micrometre. */
export const partPoint = (part: ToolpathPart): PartPoint => [
  Number(part.center[0].toFixed(3)),
  Number(part.center[1].toFixed(3)),
]

/**
 * What an operation keeps to suppress `indices` of its parts: their middles, after the points
 * that match no part (`unmatched`), which stay until they are cleared.
 */
export function suppressionPoints(
  parts: readonly ToolpathPart[],
  indices: ReadonlySet<number>,
  unmatched: readonly PartPoint[] = []
): PartPoint[] {
  return [
    ...unmatched,
    ...parts.filter((part) => indices.has(part.index)).map(partPoint),
  ]
}

/**
 * NC without the parts it suppresses: a comment says where each was, in place of its lines.
 * The machine gets nothing it does not run; `resolvedLine` and `ownLine` map between the lines.
 */
export function withoutParts(
  nc: string,
  parts: readonly ToolpathPart[],
  suppressed: ReadonlySet<number>
): string {
  if (!suppressed.size) return nc
  const lines = nc.split("\n")
  const kept: string[][] = []
  let next = 0
  for (const part of parts) {
    if (!suppressed.has(part.index)) continue
    kept.push(lines.slice(next, part.startLine - 1), [
      `; Suppressed: path ${part.index + 1}`,
    ])
    next = part.endLine
  }
  kept.push(lines.slice(next))
  return kept.flat().join("\n")
}

/** Each operation's own lines that its NC leaves out (`withoutParts`), in order. */
const leftOutOf = new WeakMap<
  Operation,
  readonly (readonly [number, number])[]
>()

/** The inclusive ranges of an operation's own lines its NC leaves out: each suppressed part's after its first. */
function leftOut(operation: Operation) {
  let ranges = leftOutOf.get(operation)
  if (!ranges) {
    const found = operation.suppressedParts?.length
      ? suppressedParts(operation)
      : null
    ranges = (found?.parts ?? [])
      .filter(
        (part) =>
          found?.matched.has(part.index) && part.endLine > part.startLine
      )
      .map((part) => [part.startLine + 1, part.endLine] as const)
    leftOutOf.set(operation, ranges)
  }
  return ranges
}

/**
 * Where a line of an operation's own NC is in the NC it resolves to, which leaves out the parts
 * it suppresses; null for a line it leaves out.
 */
export function resolvedLine(
  operation: Operation,
  line: number
): number | null {
  let shift = 0
  for (const [first, last] of leftOut(operation)) {
    if (line < first) break
    if (line <= last) return null
    shift += last - first + 1
  }
  return line - shift
}

/** The line of an operation's own NC that a line of the NC it resolves to is. */
export function ownLine(operation: Operation, line: number): number {
  let own = line
  for (const [first, last] of leftOut(operation)) {
    if (own < first) break
    own += last - first + 1
  }
  return own
}
