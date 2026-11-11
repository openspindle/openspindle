import { z } from "zod"
import type { FeatureDistance, InspectionFeature } from "./metrology"

export type SampleSummary = {
  count: number
  mean: number
  minimum: number
  maximum: number
  range: number
  sampleStandardDeviation: number
}

function summarize(values: number[]): SampleSummary | null {
  if (values.length < 2 || values.some((value) => !Number.isFinite(value)))
    return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  return {
    count: values.length,
    mean,
    minimum,
    maximum,
    range: maximum - minimum,
    sampleStandardDeviation: Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (values.length - 1)
    ),
  }
}

export type RepeatabilitySummary = {
  name: string
  attempted: number
  operationIds: string[]
  completedOperationIds: string[]
  quantities: { quantity: string; statistics: SampleSummary }[]
}

/** Same anchored geometry and probe within one frozen Run; never infer sameness from labels. */
export function featureRepeatability(
  features: readonly InspectionFeature[]
): RepeatabilitySummary[] {
  const groups = new Map<string, InspectionFeature[]>()
  for (const feature of features) {
    const { params, probe } = feature
    const placement = params.placement
    if (
      placement.kind !== "anchor" ||
      !probe ||
      !Number.isFinite(probe.ballDiameter) ||
      probe.ballDiameter === null ||
      probe.ballDiameter <= 0 ||
      (params.routine !== "pocket-center" && params.routine !== "boss-center")
    )
      continue
    // A boss start with explicit work Z is not invariant after its cycle resets work Z.
    if (params.routine === "boss-center" && placement.height !== undefined)
      continue
    const key = JSON.stringify([
      params.routine,
      params.corner,
      params.axes,
      params.distance,
      params.depth,
      placement.anchorId,
      placement.offset,
      placement.height ?? null,
      probe.id,
      probe.ballDiameter,
    ])
    groups.set(key, [...(groups.get(key) ?? []), feature])
  }
  return [...groups.values()].flatMap((group) => {
    const complete = group.filter(
      (feature) => feature.status === "complete" && feature.result
    )
    if (complete.length < 2) return []
    const quantities: RepeatabilitySummary["quantities"] = []
    for (const [quantity, get] of [
      ["Center X", (feature: InspectionFeature) => feature.result?.origin[0]],
      ["Center Y", (feature: InspectionFeature) => feature.result?.origin[1]],
      ["Top Z", (feature: InspectionFeature) => feature.result?.top],
      ["X span", (feature: InspectionFeature) => feature.result?.size[0]],
      ["Y span", (feature: InspectionFeature) => feature.result?.size[1]],
    ] as const) {
      const values = complete.map(get)
      if (values.some((value) => value === null || value === undefined))
        continue
      const statistics = summarize(values as number[])
      if (statistics) quantities.push({ quantity, statistics })
    }
    if (!quantities.length) return []
    return [
      {
        name: group[0].name,
        attempted: group.length,
        operationIds: group.map((feature) => feature.operationId),
        completedOperationIds: complete.map((feature) => feature.operationId),
        quantities,
      },
    ]
  })
}

export type MeasuredDimension = { id: string; label: string; measured: number }

export function measuredDimensions(
  features: readonly InspectionFeature[],
  comparison: FeatureDistance | null
): MeasuredDimension[] {
  const dimensions: MeasuredDimension[] = []
  for (const feature of features) {
    if (feature.status !== "complete") continue
    for (const axis of [0, 1] as const) {
      const measured = feature.result?.size[axis]
      if (
        measured !== null &&
        measured !== undefined &&
        Number.isFinite(measured) &&
        measured > 0
      )
        dimensions.push({
          id: `${feature.operationId}:span-${axis}`,
          label: `${feature.name} · ${axis === 0 ? "X" : "Y"} span`,
          measured,
        })
    }
  }
  if (
    comparison &&
    Number.isFinite(comparison.distanceXY) &&
    comparison.distanceXY > 0
  )
    dimensions.push({
      id: `${comparison.from}:${comparison.to}:distance`,
      label: "Selected center distance · XY",
      measured: comparison.distanceXY,
    })
  return dimensions
}

export const ReferenceInputSchema = z.object({
  dimensionId: z.string().min(1),
  nominal: z.number().positive().max(10000),
  tolerance: z.number().min(0).max(10000),
})
export type ReferenceInput = z.infer<typeof ReferenceInputSchema>
export type ReferenceCheck = MeasuredDimension & {
  nominal: number
  tolerance: number
  error: number
  withinTolerance: boolean
}

/** User-supplied reference only: this neither verifies nor changes probe calibration. */
export function referenceCheck(
  dimensions: readonly MeasuredDimension[],
  input: ReferenceInput
): ReferenceCheck | null {
  if (!ReferenceInputSchema.safeParse(input).success) return null
  const dimension = dimensions.find((item) => item.id === input.dimensionId)
  if (!dimension || !Number.isFinite(dimension.measured)) return null
  const error = dimension.measured - input.nominal
  return {
    ...dimension,
    nominal: input.nominal,
    tolerance: input.tolerance,
    error,
    withinTolerance: Math.abs(error) <= input.tolerance + 1e-9,
  }
}
