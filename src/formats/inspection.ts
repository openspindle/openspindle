import type { JobMeasurement, JobPhase } from "@/machine/contract"
import { featureRepeatability } from "@/domain/probing/inspection-analysis"
import type { ReferenceCheck } from "@/domain/probing/inspection-analysis"
import type {
  FeatureDistance,
  InspectionFeature,
  InspectionSurface,
} from "@/domain/probing/metrology"

/** Export-only report; it is never imported as machine commands or workspace data. */
export type InspectionReport = {
  version: 1
  jobId: string
  plateId: string
  plateName: string
  device: { id: string; name: string; source: "simulator" | "physical" } | null
  startedAt: number
  endedAt: number | null
  jobPhase: JobPhase
  units: "mm"
  featureFrame: "machine"
  surfaceFrame: "relative-height"
  surfaceMethod: "sampled-least-squares-residual-peak-to-valley"
  calibration: "unverified"
  effects: readonly string[]
  features: InspectionFeature[]
  surfaces: InspectionSurface[]
  missing: {
    operationId: string
    name: string
    task: "origin" | "grid"
    reason: string
  }[]
  unassignedMeasurements: readonly JobMeasurement[]
}

export function inspectionJson(
  report: InspectionReport,
  comparison: FeatureDistance | null,
  reference: ReferenceCheck | null = null
): string {
  return JSON.stringify(
    {
      ...report,
      comparison,
      repeatability: featureRepeatability(report.features),
      reference,
    },
    null,
    2
  )
}

/** Quoted RFC-style cells, protecting user labels from spreadsheet formula evaluation. */
function cell(value: string | number | null): string {
  if (value === null) return '""'
  let text = String(value)
  if (typeof value === "string" && /^\s*[=+\-@\t\r\n]/.test(text))
    text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

/** A long table: provenance, status and units accompany every exported value. */
export function inspectionCsv(
  report: InspectionReport,
  comparison: FeatureDistance | null,
  reference: ReferenceCheck | null = null
): string {
  const rows: (string | number | null)[][] = [
    [
      "job_id",
      "plate",
      "source",
      "job_phase",
      "operation_id",
      "operation",
      "status",
      "frame",
      "quantity",
      "value",
      "unit",
      "problem",
    ],
  ]
  const add = (
    id: string,
    name: string,
    status: string,
    frame: string,
    quantity: string,
    value: string | number | null,
    unit = "mm",
    problem: string | null = null
  ) =>
    rows.push([
      report.jobId,
      report.plateName,
      report.device?.source ?? "unknown",
      report.jobPhase,
      id,
      name,
      status,
      frame,
      quantity,
      value,
      unit,
      problem,
    ])
  add("", "", "metadata", "", "calibration", report.calibration, "")
  add("", "", "metadata", "", "device_id", report.device?.id ?? null, "")
  add("", "", "metadata", "", "device_name", report.device?.name ?? null, "")
  add("", "", "metadata", "", "surface_method", report.surfaceMethod, "")
  add("", "", "metadata", "", "started_at", report.startedAt, "unix-ms")
  add("", "", "metadata", "", "ended_at", report.endedAt, "unix-ms")
  for (const effect of report.effects)
    add("", "", "metadata", "", "cycle_effect", effect, "")
  for (const missing of report.missing)
    add(
      missing.operationId,
      missing.name,
      "unconfirmed",
      "",
      missing.task,
      null,
      "",
      missing.reason
    )
  report.unassignedMeasurements.forEach((measurement, index) => {
    const name = `Unassigned measurement ${index + 1}`
    const raw = (quantity: string, value: number | null, frame: string) =>
      add("", name, "unassigned", frame, quantity, value)
    if (measurement.kind === "contacts")
      measurement.contacts.forEach((contact, at) => {
        for (const [axis, coordinate] of [
          ["x", 0],
          ["y", 1],
          ["z", 2],
        ] as const)
          raw(`contact_${at + 1}_${axis}`, contact[coordinate], "machine")
      })
    if (measurement.kind === "grid") {
      raw("start_x", measurement.start[0], "machine")
      raw("start_y", measurement.start[1], "machine")
      raw("width", measurement.width, "grid-offset")
      raw("depth", measurement.depth, "grid-offset")
      measurement.xCoordinates.forEach((value, c) =>
        raw(`column_${c + 1}_x`, value, "grid-offset")
      )
      measurement.yCoordinates.forEach((value, r) =>
        raw(`row_${r + 1}_y`, value, "grid-offset")
      )
      measurement.heights.forEach((row, r) =>
        row.forEach((height, c) =>
          raw(`height_row_${r + 1}_column_${c + 1}`, height, "relative-height")
        )
      )
    }
  })
  for (const feature of report.features) {
    const { operationId, name, status, problem, result } = feature
    const fact = (
      quantity: string,
      value: number | string | null,
      unit = "mm"
    ) =>
      add(operationId, name, status, "machine", quantity, value, unit, problem)
    fact("routine", feature.routine, "")
    fact("probe", feature.probe?.name ?? null, "")
    fact("probe_id", feature.probe?.id ?? null, "")
    fact("ball_diameter", feature.probe?.ballDiameter ?? null)
    fact("contacts_received", feature.contacts.length, "count")
    fact("contacts_expected", feature.expectedContacts, "count")
    for (const [axis, index] of [
      ["x", 0],
      ["y", 1],
    ] as const) {
      fact(`${axis}_position`, result?.origin[index] ?? null)
      fact(`${axis}_span`, result?.size[index] ?? null)
      fact(`${axis}_side_minus`, feature.bounds[index]?.[0] ?? null)
      fact(`${axis}_side_plus`, feature.bounds[index]?.[1] ?? null)
    }
    fact("top_z", result?.top ?? null)
    fact("second_touch_correction", feature.secondTouchCorrection)
    feature.contacts.forEach((contact, index) => {
      for (const [axis, coordinate] of [
        ["x", 0],
        ["y", 1],
        ["z", 2],
      ] as const)
        fact(`contact_${index + 1}_${axis}`, contact[coordinate])
    })
  }
  for (const surface of report.surfaces) {
    const { operationId, name, status, problem, analysis, grid } = surface
    const fact = (quantity: string, value: number | null, unit = "mm") =>
      add(
        operationId,
        name,
        status,
        "relative-height",
        quantity,
        value,
        unit,
        problem
      )
    fact("samples", analysis?.samples.valid ?? null, "count")
    add(
      operationId,
      name,
      status,
      "",
      "probe_id",
      surface.probe?.id ?? null,
      "",
      problem
    )
    add(
      operationId,
      name,
      status,
      "",
      "probe",
      surface.probe?.name ?? null,
      "",
      problem
    )
    fact("columns", grid.columns, "count")
    fact("rows", grid.rows, "count")
    fact("expected_columns", surface.expected.columns, "count")
    fact("expected_rows", surface.expected.rows, "count")
    add(
      operationId,
      name,
      status,
      "machine",
      "grid_start_x",
      grid.start[0],
      "mm",
      problem
    )
    add(
      operationId,
      name,
      status,
      "machine",
      "grid_start_y",
      grid.start[1],
      "mm",
      problem
    )
    grid.xCoordinates.forEach((offset, c) =>
      add(
        operationId,
        name,
        status,
        "grid-offset",
        `column_${c + 1}_x`,
        offset,
        "mm",
        problem
      )
    )
    grid.yCoordinates.forEach((offset, r) =>
      add(
        operationId,
        name,
        status,
        "grid-offset",
        `row_${r + 1}_y`,
        offset,
        "mm",
        problem
      )
    )
    fact("outliers", analysis?.outliers.length ?? null, "count")
    fact("height_range", analysis?.statistics?.range ?? null)
    fact("sampled_flatness_all_points", surface.sampledFlatness)
    fact("flatness_without_outliers", analysis?.surface?.flatness ?? null)
    fact("tilt_without_outliers", analysis?.surface?.tilt ?? null)
    grid.heights.forEach((row, r) =>
      row.forEach((height, c) =>
        fact(`height_row_${r + 1}_column_${c + 1}`, height)
      )
    )
  }
  if (comparison) {
    const name = `${comparison.from} to ${comparison.to}`
    for (const [quantity, value] of [
      ["delta_x", comparison.deltaX],
      ["delta_y", comparison.deltaY],
      ["center_distance_xy", comparison.distanceXY],
    ] as const)
      add("", name, "complete", "machine", quantity, value)
  }
  for (const group of featureRepeatability(report.features)) {
    const ids = group.operationIds.join(";")
    add(
      ids,
      group.name,
      "summary",
      "machine",
      "repeat_attempted",
      group.attempted,
      "count"
    )
    add(
      ids,
      group.name,
      "summary",
      "machine",
      "repeat_completed_ids",
      group.completedOperationIds.join(";"),
      ""
    )
    for (const { quantity, statistics } of group.quantities)
      for (const [statistic, value] of Object.entries(statistics))
        add(
          ids,
          group.name,
          "summary",
          "machine",
          `${quantity}_${statistic}`,
          value,
          statistic === "count" ? "count" : "mm"
        )
  }
  if (reference) {
    for (const [quantity, value] of [
      ["measured", reference.measured],
      ["nominal", reference.nominal],
      ["tolerance", reference.tolerance],
      ["signed_error", reference.error],
    ] as const)
      add(
        reference.id,
        reference.label,
        "reference-check",
        "dimension",
        quantity,
        value
      )
    add(
      reference.id,
      reference.label,
      "reference-check",
      "dimension",
      "within_tolerance",
      String(reference.withinTolerance),
      ""
    )
  }
  return `${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`
}
