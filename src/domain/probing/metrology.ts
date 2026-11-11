import { HeightMapSchema } from "@/machine/contract"
import type { GridMeasurement } from "@/machine/contract"
import type { XYZ } from "../geometry/frame"
import { analyzeHeightMap, sampledSurfaceFit } from "./tasks/grid/analysis"
import type { HeightMapAnalysis } from "./tasks/grid/analysis"
import type { GridParams } from "./tasks/grid/params"
import { findsCorner, setsWorkXY, setsWorkZ } from "./tasks/origin/params"
import type { OriginParams } from "./tasks/origin/params"
import { originResult } from "./tasks/origin/result"
import type { OriginResult } from "./tasks/origin/result"

export type InspectionFeature = {
  operationId: string
  name: string
  routine: OriginParams["routine"]
  probe: { id: string; name: string; ballDiameter: number | null } | null
  params: OriginParams
  contacts: readonly XYZ<"machine">[]
  expectedContacts: number
  status: "complete" | "incomplete" | "invalid"
  problem: string | null
  result: OriginResult | null
  /** Opposed sides in machine mm, only for a centre routine with a positive measured span. */
  bounds: readonly [
    readonly [number, number] | null,
    readonly [number, number] | null,
  ]
  /** Largest fast-to-slow contact correction; not calibrated repeatability. */
  secondTouchCorrection: number | null
}

/** Contacts alone do not prove completion: the operation must also have finished. */
export function inspectFeature(input: {
  operationId: string
  name: string
  params: OriginParams
  probe: InspectionFeature["probe"]
  contacts: readonly XYZ<"machine">[]
  finished: boolean
}): InspectionFeature {
  const { params, contacts, probe } = input
  const axes = setsWorkXY(params.routine, params.axes)
  let expectedContacts = setsWorkZ(params.routine) ? 2 : 0
  expectedContacts += findsCorner(params.routine)
    ? 4
    : axes.filter(Boolean).length * 4
  const base = {
    operationId: input.operationId,
    name: input.name,
    routine: params.routine,
    params,
    probe,
    contacts,
    expectedContacts,
    result: null,
    bounds: [null, null] as const,
    secondTouchCorrection: null,
  }
  const ball = probe?.ballDiameter
  if (
    ball === null ||
    ball === undefined ||
    !Number.isFinite(ball) ||
    ball <= 0 ||
    contacts.some((contact) => contact.some((value) => !Number.isFinite(value)))
  )
    return {
      ...base,
      status: "invalid",
      problem: "A valid probe ball and finite machine contacts are required.",
    }
  if (contacts.length > expectedContacts)
    return {
      ...base,
      status: "invalid",
      problem:
        "Extra contacts make their association with this routine uncertain.",
    }
  if (!input.finished || contacts.length !== expectedContacts)
    return {
      ...base,
      status: "incomplete",
      problem: `Finished routine required: ${contacts.length} / ${expectedContacts} contacts received.`,
    }
  if (!findsCorner(params.routine)) {
    let next = setsWorkZ(params.routine) ? 2 : 0
    for (const axis of [0, 1] as const) {
      if (!axes[axis]) continue
      if (contacts[next + 3][axis] <= contacts[next + 1][axis])
        return {
          ...base,
          status: "invalid",
          problem:
            "Opposing slow contacts must be ordered from minus to plus along each measured axis.",
        }
      next += 4
    }
  }
  const result = originResult(params, ball, contacts)
  if (
    result.size.some((size) => size !== null && size <= 0) ||
    [...result.origin, result.top, ...result.size].some(
      (value) => value !== null && !Number.isFinite(value)
    )
  )
    return {
      ...base,
      status: "invalid",
      problem:
        "The contacts do not describe a positive span in the expected order.",
    }
  const boundsAt = (axis: 0 | 1) => {
    const size = result.size[axis]
    const center = result.origin[axis]
    if (size === null || center === null) return null
    return [center - size / 2, center + size / 2] as const
  }
  const bounds = [boundsAt(0), boundsAt(1)] as const
  let correction = 0
  for (let index = 0; index < contacts.length; index += 2)
    correction = Math.max(
      correction,
      Math.hypot(
        ...contacts[index + 1].map(
          (value, axis) => value - contacts[index][axis]
        )
      )
    )
  return {
    ...base,
    status: "complete",
    problem: null,
    result,
    bounds,
    secondTouchCorrection: correction,
  }
}

export type InspectionSurface = {
  operationId: string
  name: string
  grid: GridMeasurement
  params: GridParams
  probe: { id: string; name: string } | null
  expected: { columns: number; rows: number }
  analysis: HeightMapAnalysis | null
  /** Least-squares residual peak-to-valley including every measured point, even outliers. */
  sampledFlatness: number | null
  status: "complete" | "incomplete" | "invalid"
  problem: string | null
}

export function inspectSurface(input: {
  operationId: string
  name: string
  grid: GridMeasurement
  params: GridParams
  probe: InspectionSurface["probe"]
  expected: InspectionSurface["expected"]
  finished: boolean
}): InspectionSurface {
  const { grid, expected } = input
  const base = {
    operationId: input.operationId,
    name: input.name,
    grid,
    params: input.params,
    probe: input.probe,
    expected,
    analysis: null,
    sampledFlatness: null,
  }
  const parsed = HeightMapSchema.safeParse({
    columns: grid.columns,
    rows: grid.rows,
    heights: grid.heights,
    xCoordinates: grid.xCoordinates,
    yCoordinates: grid.yCoordinates,
    raw: "",
    receivedAt: grid.at,
    deviceId: "inspection",
  })
  if (!parsed.success)
    return {
      ...base,
      status: "invalid",
      problem:
        "The reported grid has invalid heights or inconsistent dimensions.",
    }
  // NC dimensions are rounded to 0.001 mm, table coordinates printed separately.
  const tolerance = 0.0011
  const orderedAxis = (
    values: readonly number[],
    extent: number,
    reversed: boolean
  ) =>
    Number.isFinite(extent) &&
    extent > 0 &&
    values.every((value, index) => {
      const step = reversed ? values.length - 1 - index : index
      const expectedOffset = (extent * step) / (values.length - 1)
      const previous = values[index - 1]
      const ordered =
        index === 0 || (reversed ? value < previous : value > previous)
      return ordered && Math.abs(value - expectedOffset) <= tolerance
    })
  if (
    !grid.start.every(Number.isFinite) ||
    !orderedAxis(grid.xCoordinates, grid.width, false) ||
    !orderedAxis(grid.yCoordinates, grid.depth, true) ||
    Math.abs(grid.width - input.params.size[0]) > tolerance ||
    Math.abs(grid.depth - input.params.size[1]) > tolerance
  )
    return {
      ...base,
      status: "invalid",
      problem:
        "The reported grid geometry must match the operation's extents and contain distinct, evenly spaced X/Y offsets in reported order.",
    }
  const analysis = analyzeHeightMap(parsed.data, { expected })
  const sampledFlatness =
    sampledSurfaceFit(parsed.data.heights)?.flatness ?? null
  const measured = { ...base, analysis, sampledFlatness }
  if (!input.finished || grid.status !== "completed")
    return {
      ...measured,
      status: "incomplete",
      problem: "The grid operation did not finish successfully.",
    }
  if (analysis.verdict === "unreliable")
    return {
      ...measured,
      status: "invalid",
      problem: analysis.reasons
        .filter((reason) => reason.code !== "height-map/flat")
        .map((reason) => reason.message)
        .join(" "),
    }
  return { ...measured, status: "complete", problem: null }
}

export type FeatureDistance = {
  from: string
  to: string
  deltaX: number
  deltaY: number
  distanceXY: number
}

/** Only two complete centres in the same report; never combine corners or partial axes. */
export function featureDistance(
  from: InspectionFeature,
  to: InspectionFeature
): FeatureDistance | null {
  if (
    from.operationId === to.operationId ||
    from.status !== "complete" ||
    to.status !== "complete" ||
    findsCorner(from.routine) ||
    findsCorner(to.routine)
  )
    return null
  const a = from.result?.origin
  const b = to.result?.origin
  if (
    !a ||
    !b ||
    a[0] === null ||
    a[1] === null ||
    b[0] === null ||
    b[1] === null
  )
    return null
  const deltaX = b[0] - a[0]
  const deltaY = b[1] - a[1]
  return {
    from: from.operationId,
    to: to.operationId,
    deltaX,
    deltaY,
    distanceXY: Math.hypot(deltaX, deltaY),
  }
}
