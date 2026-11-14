import { boundTools } from "@/domain/tools/tool-table"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { reportsProbingMeasurements } from "@/domain/probing/strategies"
import { inspectFeature, inspectSurface } from "@/domain/probing/metrology"
import type { InspectionReport } from "@/formats/inspection"
import type { JobMeasurement } from "@/machine/contract"
import { runStages } from "./run-stages"
import type { JobView } from "./job-view"

/** Measurements are associated using the same stages as the run cards and the frozen Run. */
export function inspectionReport(view: JobView): InspectionReport | null {
  if (view.kind === "idle" || !view.session) return null
  const { session, job } = view
  if (session.runId !== job.id) return null
  const stages = runStages(view, session).operations ?? []
  const features: InspectionReport["features"] = []
  const surfaces: InspectionReport["surfaces"] = []
  const missing: InspectionReport["missing"] = []
  const machine = kitForPlate(session.plate).probing
  const reporting = stages.filter(({ operation, span }) => {
    const { source } = operation
    return (
      span !== null &&
      source.kind === "probing" &&
      reportsProbingMeasurements(source, machine, session.plate)
    )
  })
  const ambiguous = (task: "origin" | "grid") => {
    const expected = reporting.filter(
      ({ operation }) =>
        operation.source.kind === "probing" && operation.source.task === task
    ).length
    const received = job.measurements.filter(
      ({ kind }) => kind === (task === "origin" ? "contacts" : "grid")
    ).length
    return received > expected || (expected > 1 && received !== expected)
  }
  const ambiguousOrigin = ambiguous("origin")
  const ambiguousGrid = ambiguous("grid")
  const assigned = new Set<JobMeasurement>()
  for (const stage of stages) {
    const { operation, contacts, grid, status } = stage
    const { source } = operation
    if (
      source.kind !== "probing" ||
      (source.task !== "origin" && source.task !== "grid") ||
      stage.span === null
    )
      continue
    let reason: string | null = null
    if (!reportsProbingMeasurements(source, machine, session.plate))
      reason = "This operation's played route does not report measurements."
    else if (
      (source.task === "origin" && ambiguousOrigin) ||
      (source.task === "grid" && ambiguousGrid)
    )
      reason =
        "Not every reporting routine has its own measurement yet; attribution is unconfirmed. Raw measurements remain in JSON/CSV exports."
    else if (
      (source.task === "origin" && !contacts) ||
      (source.task === "grid" && !grid)
    )
      reason = "No measurement received for this operation."
    if (reason) {
      missing.push({
        operationId: operation.id,
        name: operation.name,
        task: source.task,
        reason,
      })
      continue
    }
    const finished = status === "done"
    const id = boundTools(session.plate, operation).get(source.probe)
    const tool = session.tools.find((item) => item.id === id)
    if (source.task === "origin" && contacts) {
      assigned.add(contacts)
      features.push(
        inspectFeature({
          operationId: operation.id,
          name: operation.name,
          params: source.params,
          probe: tool
            ? { id: tool.id, name: tool.name, ballDiameter: tool.diameter }
            : null,
          contacts: contacts.contacts,
          finished,
        })
      )
    }
    if (source.task === "grid" && grid) {
      assigned.add(grid)
      surfaces.push(
        inspectSurface({
          operationId: operation.id,
          name: operation.name,
          grid,
          params: source.params,
          probe: tool ? { id: tool.id, name: tool.name } : null,
          expected: {
            columns: source.params.points[0],
            rows: source.params.points[1],
          },
          finished,
        })
      )
    }
  }
  const unassignedMeasurements = job.measurements.filter(
    (measurement) =>
      (measurement.kind === "contacts" || measurement.kind === "grid") &&
      !assigned.has(measurement)
  )
  if (
    !features.length &&
    !surfaces.length &&
    !missing.length &&
    !unassignedMeasurements.length
  )
    return null
  return {
    version: 1,
    jobId: job.id,
    plateId: session.plate.id,
    plateName: session.label,
    device: session.device,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    jobPhase: job.phase,
    units: "mm",
    featureFrame: "machine",
    surfaceFrame: "relative-height",
    surfaceMethod: "sampled-least-squares-residual-peak-to-valley",
    calibration: "unverified",
    effects: [
      "Origin routines change the active work origin.",
      "Height grids enable height compensation.",
    ],
    features,
    surfaces,
    missing,
    unassignedMeasurements,
  }
}
