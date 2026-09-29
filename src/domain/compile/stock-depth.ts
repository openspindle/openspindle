import type { GCodeSegment } from "@/domain/nc/gcode"
import { formatMillimetres } from "../auto-level/params"
import { operationSubject, warning } from "../diagnostics"
import type { Area, Diagnostic } from "../diagnostics"
import { operationPhase } from "../operations/kinds"
import type { Plate } from "../plate/plate"
import { isProbeSlot } from "../tools/tool-table"
import type { CompiledPlate } from "./compile"

const EPSILON = 0.001

const mm = (value: number) => formatMillimetres(Number(value.toFixed(3)))

/** The first segment on or after a line; the program's segments are in line order. */
function firstSegment(segments: readonly GCodeSegment[], line: number) {
  let low = 0
  let high = segments.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (segments[middle].line < line) low = middle + 1
    else high = middle
  }
  return low
}

/**
 * Machining operations whose cuts all run below the stock, or all above it: their program's Z
 * zero is not where the plate's work origin puts it. CAM programs usually cut down from Z0 on
 * the stock top, so with the work origin on the stock bottom a shallow engraving would cut
 * through the stock into what is under it. Only cuts that travel in X or Y count: plunges and
 * through-cuts pass through the stock on the way.
 */
export function stockDepthWarnings(
  plate: Plate,
  compiled: CompiledPlate
): Diagnostic[] {
  const { stock, stockAnchor, workOrigin } = plate.setup
  if (!stock || stock.height <= 0) return []
  const bottom = stockAnchor[2]
  const top = bottom + stock.height
  const { segments } = compiled.program
  const operations = new Map(
    plate.operations.map((operation) => [operation.id, operation])
  )
  return compiled.spans.flatMap((span) => {
    const operation = operations.get(span.operationId)
    if (!operation || operationPhase(operation) === "setup") return []
    let highest = -Infinity
    let lowest = Infinity
    // Where the cuts are on the bed, which the 3D view marks.
    const min = [Infinity, Infinity]
    const max = [-Infinity, -Infinity]
    // The segments of the operation's own lines only.
    const end = firstSegment(segments, span.endLine + 1)
    for (
      let index = firstSegment(segments, span.bodyStartLine);
      index < end;
      index++
    ) {
      const segment = segments[index]
      if (
        segment.rapid ||
        isProbeSlot(segment.tool) ||
        Math.hypot(
          segment.end[0] - segment.start[0],
          segment.end[1] - segment.start[1]
        ) < EPSILON
      )
        continue
      for (const point of [segment.start, segment.end]) {
        highest = Math.max(highest, workOrigin[2] + point[2])
        lowest = Math.min(lowest, workOrigin[2] + point[2])
        for (const axis of [0, 1]) {
          min[axis] = Math.min(min[axis], workOrigin[axis] + point[axis])
          max[axis] = Math.max(max[axis], workOrigin[axis] + point[axis])
        }
      }
    }
    if (highest === -Infinity) return []
    const cuts: Area = {
      kind: "area",
      min: [min[0], min[1], lowest],
      max: [max[0], max[1], highest],
    }
    const details = { subject: operationSubject(operation.id), places: [cuts] }
    if (highest < bottom - EPSILON)
      return [
        warning(
          "stock-depth/below",
          `${operation.name} cuts only below the stock: its highest cut is ${mm(bottom - highest)} mm under the stock bottom. Check the work origin's Z; programs usually cut down from Z0 on the stock top.`,
          details
        ),
      ]
    if (lowest > top + EPSILON)
      return [
        warning(
          "stock-depth/above",
          `${operation.name} cuts only above the stock: its lowest cut is ${mm(lowest - top)} mm over the stock top. Check the work origin's Z and the stock height.`,
          details
        ),
      ]
    return []
  })
}
