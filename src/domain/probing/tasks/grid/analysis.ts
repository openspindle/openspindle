import type { HeightMap } from "@/machine/contract"
import { plural } from "../../../primitives"

export type GridSize = { columns: number; rows: number }

/** Zero-based indices into `HeightMap.heights[row][column]`, in the device's reported order. */
export type GridPosition = { row: number; column: number }

export type HeightSample = GridPosition & { height: number }

export type HeightStatistics = {
  /** Measured (non-null) samples. */
  count: number
  min: number
  max: number
  mean: number
  median: number
  /** max − min */
  range: number
}

export type HeightOutlier = HeightSample & {
  /** Distance from the fitted surface, relative to the median distance, in mm. */
  deviation: number
  /** Modified z-score 0.6745 · deviation / MAD; null when the MAD is zero. */
  score: number | null
}

/** The least-squares plane through the measured samples, outliers excluded. */
export type SurfaceFit = {
  /** Height change of the plane across the samples: the tilt that compensation follows. */
  tilt: number
  /** Peak-to-valley deviation of the samples from the plane. */
  flatness: number
}

export type FlatnessVerdict = "flat" | "uneven" | "unreliable"

export type FlatnessReasonCode =
  | "no-samples"
  | "size-mismatch"
  | "missing-samples"
  | "outliers"
  | "tilted"
  | "uneven"
  | "flat"

export type FlatnessReason = { code: FlatnessReasonCode; message: string }

export type HeightMapAnalysis = {
  /** Grid size reported by the device. */
  size: GridSize
  /** Grid size the operation probed, when known. */
  expected: GridSize | null
  /** False when the device grid differs from the expected size; null without an expectation. */
  sizeMatches: boolean | null
  samples: { total: number; valid: number; missing: number }
  missingPositions: GridPosition[]
  /** Null when no sample was measured. */
  statistics: HeightStatistics | null
  outliers: HeightOutlier[]
  /** Null when no sample was measured. */
  surface: SurfaceFit | null
  /** Unreliable when samples are missing or stand out, or the grid differs from the probe. */
  verdict: FlatnessVerdict
  /** Every finding behind the verdict, most severe first. */
  reasons: FlatnessReason[]
}

export type HeightMapThresholds = {
  /** Modified z-score (Iglewicz and Hoaglin) beyond which a sample is an outlier. */
  outlierScore: number
  /** Deviations up to this are probe noise, never outliers, in mm. */
  outlierFloor: number
  /** Largest peak-to-valley deviation from the plane still called flat, in mm. */
  flatnessTolerance: number
}

export const HEIGHT_MAP_THRESHOLDS: Readonly<HeightMapThresholds> = {
  outlierScore: 3.5,
  outlierFloor: 0.02,
  flatnessTolerance: 0.1,
}

export type HeightMapAnalysisOptions = Partial<HeightMapThresholds> & {
  expected?: GridSize
}

/** Fewer samples give no meaningful median deviation. */
const MIN_OUTLIER_SAMPLES = 5
const LISTED_OUTLIERS = 5

/** Signed relative height in mm, as the firmware reports it. */
export const formatHeight = (value: number) =>
  `${value > 0 ? "+" : ""}${value.toFixed(4)}`

/** Unsigned height difference in mm. */
export const formatSpan = (value: number) => value.toFixed(4)

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

function measuredSamples(heights: HeightMap["heights"]): HeightSample[] {
  return heights.flatMap((values, row) =>
    values.flatMap((height, column) =>
      height === null ? [] : [{ row, column, height }]
    )
  )
}

function statisticsOf(values: readonly number[]): HeightStatistics | null {
  if (!values.length) return null
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const value of values) {
    min = Math.min(min, value)
    max = Math.max(max, value)
    sum += value
  }
  return {
    count: values.length,
    min,
    max,
    mean: sum / values.length,
    median: median(values),
    range: max - min,
  }
}

/** Summary of the measured heights; null when nothing was measured. */
export function heightStatistics(
  heights: HeightMap["heights"]
): HeightStatistics | null {
  return statisticsOf(measuredSamples(heights).map((sample) => sample.height))
}

/** Slopes per column and per row; collinear samples fit along the axis that varies. */
function planeSlopes(
  columnSquares: number,
  rowSquares: number,
  columnRow: number,
  columnHeight: number,
  rowHeight: number
): [number, number] {
  const determinant = columnSquares * rowSquares - columnRow * columnRow
  if (determinant > 1e-9 * columnSquares * rowSquares)
    return [
      (columnHeight * rowSquares - rowHeight * columnRow) / determinant,
      (rowHeight * columnSquares - columnHeight * columnRow) / determinant,
    ]
  if (columnSquares > 0) return [columnHeight / columnSquares, 0]
  if (rowSquares > 0) return [0, rowHeight / rowSquares]
  return [0, 0]
}

/**
 * Least-squares plane over grid indices. Grid samples are evenly spaced, so it is the same plane in
 * millimetres and its residuals do not depend on the spacing.
 */
function fitPlane(
  samples: readonly HeightSample[]
): (position: GridPosition) => number {
  const count = samples.length
  const center = samples.reduce(
    (sum, sample) => ({
      column: sum.column + sample.column / count,
      row: sum.row + sample.row / count,
      height: sum.height + sample.height / count,
    }),
    { column: 0, row: 0, height: 0 }
  )
  let columnSquares = 0
  let rowSquares = 0
  let columnRow = 0
  let columnHeight = 0
  let rowHeight = 0
  for (const sample of samples) {
    const column = sample.column - center.column
    const row = sample.row - center.row
    const height = sample.height - center.height
    columnSquares += column * column
    rowSquares += row * row
    columnRow += column * row
    columnHeight += column * height
    rowHeight += row * height
  }
  const [perColumn, perRow] = planeSlopes(
    columnSquares,
    rowSquares,
    columnRow,
    columnHeight,
    rowHeight
  )
  return ({ row, column }) =>
    center.height +
    perColumn * (column - center.column) +
    perRow * (row - center.row)
}

/**
 * Robust outliers: distances from the least-squares plane scored against their median absolute
 * deviation, so a tilted bed does not hide a spike. Small deviations stay probe noise.
 */
function findOutliers(
  samples: readonly HeightSample[],
  thresholds: HeightMapThresholds
): HeightOutlier[] {
  if (samples.length < MIN_OUTLIER_SAMPLES) return []
  const plane = fitPlane(samples)
  const residuals = samples.map((sample) => sample.height - plane(sample))
  const center = median(residuals)
  const mad = median(residuals.map((residual) => Math.abs(residual - center)))
  return samples.flatMap((sample, index) => {
    const deviation = residuals[index] - center
    const score = mad > 0 ? (0.6745 * deviation) / mad : null
    const outlier =
      Math.abs(deviation) > thresholds.outlierFloor &&
      (score === null || Math.abs(score) > thresholds.outlierScore)
    return outlier ? [{ ...sample, deviation, score }] : []
  })
}

function surfaceFit(samples: readonly HeightSample[]): SurfaceFit | null {
  if (!samples.length) return null
  const plane = fitPlane(samples)
  const fitted = samples.map(plane)
  const residuals = samples.map(
    (sample, index) => sample.height - fitted[index]
  )
  return {
    tilt: Math.max(...fitted) - Math.min(...fitted),
    flatness: Math.max(...residuals) - Math.min(...residuals),
  }
}

/** One-based, as the review panel labels rows and columns. */
const positionText = ({ row, column }: GridPosition) =>
  `row ${row + 1}, column ${column + 1}`

function outlierReason(outliers: readonly HeightOutlier[]): FlatnessReason {
  const listed = outliers
    .slice(0, LISTED_OUTLIERS)
    .map(
      (outlier) =>
        `${positionText(outlier)} (${formatHeight(outlier.deviation)} mm)`
    )
  const more = outliers.length - listed.length
  return {
    code: "outliers",
    message: `${plural(outliers.length, "point")} ${outliers.length === 1 ? "stands" : "stand"} out from the surface: ${listed.join("; ")}${more ? `; and ${more} more` : ""}.`,
  }
}

function verdictOf(
  unreliable: boolean,
  surface: SurfaceFit | null,
  tolerance: number
): FlatnessVerdict {
  if (unreliable || !surface) return "unreliable"
  return surface.flatness > tolerance ? "uneven" : "flat"
}

/** Review of a height map read after probing (M375.1). Heights are relative, never machine Z. */
export function analyzeHeightMap(
  map: HeightMap,
  options: HeightMapAnalysisOptions = {}
): HeightMapAnalysis {
  const thresholds: HeightMapThresholds = {
    outlierScore: options.outlierScore ?? HEIGHT_MAP_THRESHOLDS.outlierScore,
    outlierFloor: options.outlierFloor ?? HEIGHT_MAP_THRESHOLDS.outlierFloor,
    flatnessTolerance:
      options.flatnessTolerance ?? HEIGHT_MAP_THRESHOLDS.flatnessTolerance,
  }
  const size = { columns: map.columns, rows: map.rows }
  const expected = options.expected ?? null
  const sizeMatches = expected
    ? expected.columns === size.columns && expected.rows === size.rows
    : null
  const measured = measuredSamples(map.heights)
  const missingPositions = map.heights.flatMap((values, row) =>
    values.flatMap((height, column) =>
      height === null ? [{ row, column }] : []
    )
  )
  const total = size.columns * size.rows
  const outliers = findOutliers(measured, thresholds)
  const index = ({ row, column }: GridPosition) => row * size.columns + column
  const outlying = new Set(outliers.map(index))
  const surface = surfaceFit(
    measured.filter((sample) => !outlying.has(index(sample)))
  )
  const findings: FlatnessReason[] = []
  if (!measured.length)
    findings.push({
      code: "no-samples",
      message: "The device reported no measured heights.",
    })
  if (expected && sizeMatches === false)
    findings.push({
      code: "size-mismatch",
      message: `The device reports a ${size.columns} × ${size.rows} grid, but this operation probes ${expected.columns} × ${expected.rows}. The map may be from another probe.`,
    })
  if (measured.length && missingPositions.length)
    findings.push({
      code: "missing-samples",
      message: `${missingPositions.length} of ${plural(total, "point")} ${missingPositions.length === 1 ? "has" : "have"} no measured height.`,
    })
  if (outliers.length) findings.push(outlierReason(outliers))
  const tolerance = thresholds.flatnessTolerance
  const verdict = verdictOf(findings.length > 0, surface, tolerance)
  const reasons = [...findings]
  if (surface && surface.tilt > tolerance)
    reasons.push({
      code: "tilted",
      message: `The surface is tilted by ${formatSpan(surface.tilt)} mm across the grid; compensation follows it.`,
    })
  if (surface)
    reasons.push(
      surface.flatness > tolerance
        ? {
            code: "uneven",
            message: `Peak-to-valley deviation from a plane is ${formatSpan(surface.flatness)} mm, more than ${formatSpan(tolerance)} mm. Check that the stock lies flat.`,
          }
        : {
            code: "flat",
            message: `Peak-to-valley deviation from a plane is ${formatSpan(surface.flatness)} mm, within ${formatSpan(tolerance)} mm.`,
          }
    )
  return {
    size,
    expected,
    sizeMatches,
    samples: {
      total,
      valid: measured.length,
      missing: missingPositions.length,
    },
    missingPositions,
    statistics: statisticsOf(measured.map((sample) => sample.height)),
    outliers,
    surface,
    verdict,
    reasons,
  }
}
