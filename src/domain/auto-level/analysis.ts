import { runRules } from "@/machine/contract"
import type { HeightMap } from "@/machine/contract"
import { plural } from "../primitives"
import type { StageRule } from "../rules/stages"

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

/** A finding of the review: a height-map rule's failure, coded by its id, or `height-map/flat`. */
export type FlatnessReason = { code: string; message: string }

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

function outlierMessage(outliers: readonly HeightOutlier[]): string {
  const listed = outliers
    .slice(0, LISTED_OUTLIERS)
    .map(
      (outlier) =>
        `${positionText(outlier)} (${formatHeight(outlier.deviation)} mm)`
    )
  const more = outliers.length - listed.length
  return `${plural(outliers.length, "point")} ${outliers.length === 1 ? "stands" : "stand"} out from the surface: ${listed.join("; ")}${more ? `; and ${more} more` : ""}.`
}

const UNEVEN = "height-map/uneven"

/**
 * What a height map needs to be relied on, and to be called flat: an error makes the map
 * unreliable, a warning qualifies it.
 */
export const HEIGHT_MAP_RULES: readonly StageRule<"height-map">[] = [
  {
    id: "height-map/no-samples",
    stage: "height-map",
    label: "Heights measured",
    description:
      "The device reports measured heights; without any, there is no surface to follow.",
    severity: "error",
    configurable: false,
    test: ({ measured }) => measured > 0,
    explain: () => ({ problem: "The device reported no measured heights." }),
  },
  {
    id: "height-map/size-mismatch",
    stage: "height-map",
    label: "Grid size",
    description:
      "The device's grid is the one the operation probes; another may be from another probe.",
    severity: "error",
    configurable: false,
    test: ({ size, expected }) =>
      !expected ||
      (expected.columns === size.columns && expected.rows === size.rows),
    explain: ({ first: { size, expected } }) => {
      const probed = expected ?? size
      return {
        problem: `The device reports a ${size.columns} × ${size.rows} grid, but this operation probes ${probed.columns} × ${probed.rows}. The map may be from another probe.`,
      }
    },
  },
  {
    id: "height-map/missing-samples",
    stage: "height-map",
    label: "Every point measured",
    description: "Every point of the grid has a measured height.",
    severity: "error",
    configurable: false,
    test: ({ measured, missing }) => !measured || !missing,
    explain: ({ first: { missing, total } }) => ({
      problem: `${missing} of ${plural(total, "point")} ${missing === 1 ? "has" : "have"} no measured height.`,
    }),
  },
  {
    id: "height-map/outliers",
    stage: "height-map",
    label: "No outliers",
    description:
      "No height stands out from the fitted surface by more than probe noise.",
    severity: "error",
    configurable: false,
    test: ({ outliers }) => !outliers.length,
    explain: ({ first }) => ({ problem: outlierMessage(first.outliers) }),
  },
  {
    id: "height-map/tilted",
    stage: "height-map",
    label: "Level surface",
    description:
      "The surface tilts across the grid by no more than the flatness tolerance; compensation follows a larger tilt.",
    severity: "warning",
    configurable: false,
    test: ({ surface, tolerance }) => !surface || surface.tilt <= tolerance,
    explain: ({ first }) => ({
      problem: `The surface is tilted by ${formatSpan(first.surface?.tilt ?? 0)} mm across the grid; compensation follows it.`,
    }),
  },
  {
    id: UNEVEN,
    stage: "height-map",
    label: "Flat surface",
    description:
      "The heights deviate from a plane by no more than the flatness tolerance.",
    severity: "warning",
    configurable: false,
    test: ({ surface, tolerance }) => !surface || surface.flatness <= tolerance,
    explain: ({ first }) => ({
      problem: `Peak-to-valley deviation from a plane is ${formatSpan(first.surface?.flatness ?? 0)} mm, more than ${formatSpan(first.tolerance)} mm. Check that the stock lies flat.`,
    }),
  },
]

/**
 * Review of a height map read after probing (M375.1), as a view of its rules: their failures in
 * list order, then that the surface is flat where it has one and it is not uneven. Heights are
 * relative, never machine Z.
 */
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
  const tolerance = thresholds.flatnessTolerance
  const failures = runRules(HEIGHT_MAP_RULES, [
    {
      size,
      expected,
      total,
      measured: measured.length,
      missing: missingPositions.length,
      outliers,
      surface,
      tolerance,
    },
  ])
  const reasons: FlatnessReason[] = failures.map((failure) => ({
    code: failure.rule.id,
    message: failure.rule.explain(failure).problem,
  }))
  const uneven = failures.some((failure) => failure.rule.id === UNEVEN)
  if (surface && !uneven)
    reasons.push({
      code: "height-map/flat",
      message: `Peak-to-valley deviation from a plane is ${formatSpan(surface.flatness)} mm, within ${formatSpan(tolerance)} mm.`,
    })
  const unreliable =
    !surface || failures.some((failure) => failure.severity === "error")
  const verdict: FlatnessVerdict = unreliable
    ? "unreliable"
    : uneven
      ? "uneven"
      : "flat"
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
