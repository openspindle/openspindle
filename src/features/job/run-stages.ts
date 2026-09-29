import type { OperationSpan } from "@/domain/compile/compile"
import type { Operation } from "@/domain/operations/operation"
import type {
  ContactsMeasurement,
  GridMeasurement,
  JobMeasurement,
  TouchMeasurement,
} from "@/machine/contract"
import type { JobSubject, JobView } from "./job-view"

/**
 * Where one stage of a run is: not reached yet, running, waiting for the user, finished, or
 * where the job ended early (failed or stopped there, not run after it).
 */
export type StageStatus =
  "pending" | "active" | "waiting" | "done" | "failed" | "stopped" | "skipped"

/** One operation of the plate as the job runs it, with what the machine measured in it. */
export type OperationStage = {
  readonly operation: Operation
  readonly span: OperationSpan | null
  readonly status: StageStatus
  /** The stock top the machine's Z probe touched. */
  readonly surface: TouchMeasurement | null
  /** The grid the machine probed. */
  readonly grid: GridMeasurement | null
  /** The contacts the machine's 3D probing routine made. */
  readonly contacts: ContactsMeasurement | null
  /** Tools measured at the tool sensor on changing to them. */
  readonly tools: readonly TouchMeasurement[]
}

export type RunStages = {
  readonly preflight: StageStatus
  readonly transfer: StageStatus
  /** Null for a job this window did not start: its plate is unknown here. */
  readonly operations: readonly OperationStage[] | null
  readonly finish: StageStatus
}

const PENDING_OPERATIONS = (subject: JobSubject | null) =>
  subject?.plate.operations.map((operation) =>
    operationStage(operation, subject, "pending")
  ) ?? []

function operationStage(
  operation: Operation,
  subject: JobSubject,
  status: StageStatus
): OperationStage {
  return {
    operation,
    span:
      subject.compiled.spans.find(
        (span) => span.operationId === operation.id
      ) ?? null,
    status,
    surface: null,
    grid: null,
    contacts: null,
    tools: [],
  }
}

/** The operation whose lines hold `line`, or hold the next one (a player reports the line before a pause). */
function operationAt(stages: readonly OperationStage[], line: number): number {
  const holds = (at: number) =>
    stages.findIndex(
      ({ span }) => !!span && at >= span.startLine && at <= span.endLine
    )
  const found = holds(line)
  return found >= 0 ? found : holds(line + 1)
}

/** The tool numbers an operation's program changes to. */
const changesTo = (subject: JobSubject, operation: Operation) =>
  subject.compiled.sections
    .filter(
      (section) =>
        section.kind === "tool-change" && section.operationId === operation.id
    )
    .map((section) => section.tool)

/**
 * The operations the machine has reached and what it measured in each. The reported line only
 * moves with feed moves (Player reports the last G1/G2/G3 block), so probing and tool changes
 * are placed by what they report instead, in order: a measurement or a tool request belongs to
 * the first operation from the one reached so far that probes or changes to that tool.
 */
function reachedOperations(view: Exclude<JobView, { kind: "idle" }>) {
  const subject = view.session
  if (!subject) return null
  const stages = subject.plate.operations.map((operation) =>
    operationStage(operation, subject, "pending")
  )
  const taken = new Set<string>()
  let reached = -1
  const place = (key: string, fits: (index: number) => boolean) => {
    for (let index = Math.max(reached, 0); index < stages.length; index++)
      if (fits(index) && !taken.has(`${key}:${index}`)) {
        taken.add(`${key}:${index}`)
        reached = index
        return index
      }
    return -1
  }
  const kindAt = (index: number) => stages[index].operation.source.kind
  const measured: Map<number, JobMeasurement[]> = new Map()
  for (const measurement of view.job.measurements) {
    let index = -1
    if (measurement.kind === "grid")
      index = place("grid", (at) => kindAt(at) === "auto-level")
    else if (measurement.kind === "contacts")
      index = place("contacts", (at) => kindAt(at) === "probe-3d")
    else if (measurement.target === "surface")
      index = place("surface", (at) => kindAt(at) === "auto-z-height")
    else if (measurement.tool !== null) {
      const tool = measurement.tool
      index = place(`tool-${tool}`, (at) =>
        changesTo(subject, stages[at].operation).includes(tool)
      )
    }
    if (index >= 0)
      measured.set(index, [...(measured.get(index) ?? []), measurement])
  }
  if (view.kind === "waiting-tool" && view.request.number !== null) {
    const tool = view.request.number
    const index = stages.findIndex(
      ({ operation }, at) =>
        at >= Math.max(reached, 0) &&
        changesTo(subject, operation).includes(tool)
    )
    reached = Math.max(reached, index)
  }
  if ("point" in view && view.point)
    reached = Math.max(reached, operationAt(stages, view.point.line))
  const line = view.job.progress?.line
  if (line !== undefined) reached = Math.max(reached, operationAt(stages, line))
  const withMeasurements = stages.map((stage, index) => {
    const latest = [...(measured.get(index) ?? [])].reverse()
    return {
      ...stage,
      surface:
        latest.find(
          (item): item is TouchMeasurement =>
            item.kind === "touch" && item.target === "surface"
        ) ?? null,
      grid:
        latest.find((item): item is GridMeasurement => item.kind === "grid") ??
        null,
      contacts:
        latest.find(
          (item): item is ContactsMeasurement => item.kind === "contacts"
        ) ?? null,
      tools: latest
        .filter(
          (item): item is TouchMeasurement =>
            item.kind === "touch" && item.target === "tool-sensor"
        )
        .reverse(),
    }
  })
  return { stages: withMeasurements, reached }
}

const withStatus = (
  stages: readonly OperationStage[],
  status: (index: number) => StageStatus
) => stages.map((stage, index) => ({ ...stage, status: status(index) }))

/** Done before the operation reached, `current` at it, `after` beyond it. */
const around =
  (reached: number, current: StageStatus, after: StageStatus) =>
  (index: number): StageStatus => {
    if (index < reached) return "done"
    if (index === reached) return current
    return after
  }

/** Pure: the run's stages from the job view and the plate it runs. */
export function runStages(
  view: JobView,
  selected: JobSubject | null
): RunStages {
  if (view.kind === "idle")
    return {
      preflight: "active",
      transfer: "pending",
      operations: PENDING_OPERATIONS(selected),
      finish: "pending",
    }
  const reached = reachedOperations(view)
  const operations = (status: (index: number) => StageStatus) =>
    reached ? withStatus(reached.stages, status) : null
  const at = reached?.reached ?? -1
  switch (view.kind) {
    case "transferring":
      return {
        preflight: "done",
        transfer: "active",
        operations: operations(() => "pending"),
        finish: "pending",
      }
    case "running":
    case "waiting-tool":
    case "waiting-review":
    case "paused-before-operation":
    case "paused-program":
    case "held": {
      const current = view.kind === "running" ? "active" : "waiting"
      return {
        preflight: "done",
        transfer: "done",
        operations: operations(around(at, current, "pending")),
        finish: "pending",
      }
    }
    case "finishing":
      return {
        preflight: "done",
        transfer: "done",
        operations: operations(() => "done"),
        finish: "active",
      }
    case "ended": {
      const { outcome, job } = view
      if (outcome === "completed")
        return {
          preflight: "done",
          transfer: "done",
          operations: operations(() => "done"),
          finish: "done",
        }
      const ended = outcome === "stopped" ? "stopped" : "failed"
      // Without a reported line the program never started: the transfer is where it ended.
      if (!job.progress)
        return {
          preflight: "done",
          transfer: ended,
          operations: operations(() => "skipped"),
          finish: "skipped",
        }
      return {
        preflight: "done",
        transfer: "done",
        operations: operations(around(at, ended, "skipped")),
        finish: ended,
      }
    }
  }
}
