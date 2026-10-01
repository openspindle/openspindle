import type { GCodeSegment, Point3 } from "@/domain/nc/gcode"
import { formatMillimetres } from "../auto-level/params"
import { operationSubject } from "../diagnostics"
import type { Area } from "../diagnostics"
import { operationPhase } from "../operations/kinds"
import type { OperationRuleSubject, StageRule } from "../rules/stages"
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

/** The box around an operation's cuts, in program coordinates. */
type Extent = { readonly min: Point3; readonly max: Point3 }

/**
 * The box around the cuts on an operation's own lines of a compiled plate, in program
 * coordinates; null for an operation it does not run, or one that cuts nothing. Only cuts that
 * travel in X or Y count: plunges and through-cuts pass through the stock on the way.
 */
function measureCuts(
  compiled: CompiledPlate,
  operationId: string
): Extent | null {
  const span = compiled.spans.find((item) => item.operationId === operationId)
  if (!span) return null
  const { segments } = compiled.program
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
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
    for (const point of [segment.start, segment.end])
      for (const axis of [0, 1, 2]) {
        min[axis] = Math.min(min[axis], point[axis])
        max[axis] = Math.max(max[axis], point[axis])
      }
  }
  return max[2] === -Infinity ? null : { min, max }
}

/** Each compiled plate's measured cuts, by operation: measured once, when a rule first asks. */
const measured = new WeakMap<CompiledPlate, Map<string, Extent | null>>()

function cutsOf(compiled: CompiledPlate, operationId: string): Extent | null {
  let cuts = measured.get(compiled)
  if (!cuts) {
    cuts = new Map()
    measured.set(compiled, cuts)
  }
  let extent = cuts.get(operationId)
  if (extent === undefined) {
    extent = measureCuts(compiled, operationId)
    cuts.set(operationId, extent)
  }
  return extent
}

/**
 * A machining operation's cuts on the bed, with the stock they are measured against; null
 * without stock, for a setup operation, or for one that cuts nothing.
 */
function stockCuts({ operation, plate, compiled }: OperationRuleSubject): {
  readonly area: Area
  readonly bottom: number
  readonly top: number
} | null {
  const { stock, stockAnchor, workOrigin } = plate.setup
  if (!stock || stock.height <= 0 || operationPhase(operation) === "setup")
    return null
  const cuts = cutsOf(compiled, operation.id)
  if (!cuts) return null
  const bed = (point: Point3): Point3 => [
    workOrigin[0] + point[0],
    workOrigin[1] + point[1],
    workOrigin[2] + point[2],
  ]
  const bottom = stockAnchor[2]
  return {
    area: { kind: "area", min: bed(cuts.min), max: bed(cuts.max) },
    bottom,
    top: bottom + stock.height,
  }
}

const cutsBelowStock: StageRule<"operation"> = {
  id: "stock-depth/below",
  stage: "operation",
  label: "Cuts reach the stock from above",
  description:
    "A machining operation whose cuts all run below the stock bottom has its program's Z zero somewhere the work origin does not put it.",
  severity: "warning",
  configurable: false,
  test: (subject) => {
    const cuts = stockCuts(subject)
    return !cuts || cuts.area.max[2] >= cuts.bottom - EPSILON
  },
  explain: ({ first }) => {
    const cuts = stockCuts(first)
    const under = cuts ? cuts.bottom - cuts.area.max[2] : 0
    return {
      problem: `${first.operation.name} cuts only below the stock: its highest cut is ${mm(under)} mm under the stock bottom. Check the work origin's Z; programs usually cut down from Z0 on the stock top.`,
      about: operationSubject(first.operation.id),
      places: cuts ? [cuts.area] : [],
    }
  },
}

const cutsAboveStock: StageRule<"operation"> = {
  id: "stock-depth/above",
  stage: "operation",
  label: "Cuts reach the stock from below",
  description:
    "A machining operation whose cuts all run above the stock top has its program's Z zero somewhere the work origin does not put it, or the stock is thinner than set.",
  severity: "warning",
  configurable: false,
  test: (subject) => {
    const cuts = stockCuts(subject)
    return !cuts || cuts.area.min[2] <= cuts.top + EPSILON
  },
  explain: ({ first }) => {
    const cuts = stockCuts(first)
    const over = cuts ? cuts.area.min[2] - cuts.top : 0
    return {
      problem: `${first.operation.name} cuts only above the stock: its lowest cut is ${mm(over)} mm over the stock top. Check the work origin's Z and the stock height.`,
      about: operationSubject(first.operation.id),
      places: cuts ? [cuts.area] : [],
    }
  },
}

/**
 * Machining operations whose cuts all run below the stock, or all above it: their program's Z
 * zero is not where the plate's work origin puts it. CAM programs usually cut down from Z0 on
 * the stock top, so with the work origin on the stock bottom a shallow engraving would cut
 * through the stock into what is under it.
 */
export const STOCK_DEPTH_RULES: readonly StageRule<"operation">[] = [
  cutsBelowStock,
  cutsAboveStock,
]
