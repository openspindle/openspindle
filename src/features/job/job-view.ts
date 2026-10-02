import type {
  CompiledPlate,
  CompiledSection,
  PausePoint,
} from "@/domain/compile/compile"
import type { Operation } from "@/domain/operations/operation"
import type { Plate, PlateTool } from "@/domain/plate/plate"
import { programParts } from "@/machine/contract"
import type {
  JobPhase,
  JobState,
  JobWait,
  MachineSnapshot,
} from "@/machine/contract"
import type { MotionPlan } from "@/domain/motion/types"
import type { Tool } from "@/domain/tools/tool"
import type { JobSession } from "./job-session"

export type TransferStep = Extract<
  JobPhase,
  "preparing" | "uploading" | "verifying" | "starting"
>
export type JobOutcome = Extract<
  JobPhase,
  "completed" | "stopped" | "failed" | "unverified" | "lost"
>

/** A job on the machine, with this window's Run session when the job is its own. */
type Tracked = {
  readonly job: JobState
  /** Null for a job this window did not start (another window, or before a restart). */
  readonly session: JobSession | null
}

/** A program pause that the session's compiled pause points explain. */
type Explained = {
  readonly job: JobState
  readonly session: JobSession
  readonly wait: JobWait
  readonly point: PausePoint
  readonly operation: Operation | null
}

/** The tool a manual tool change waits for, as the plate was run. */
export type ToolRequest = {
  /** The T number the machine reported; null when it reported none. */
  readonly number: number | null
  /** That number's entry in the plate's tool table. */
  readonly entry: PlateTool | null
  /** The library tool the entry referenced at Run. */
  readonly tool: Tool | null
}

/**
 * State pattern: one variant per situation the Job tab presents. Every variant but `idle`
 * mirrors the machine's job phase; nothing here infers progress or completion.
 */
export type JobView =
  | { readonly kind: "idle" }
  | (Tracked & {
      readonly kind: "transferring"
      readonly step: TransferStep
      /** Upload or readback progress; null while the step has no byte count. */
      readonly percent: number | null
    })
  | (Tracked & { readonly kind: "running" })
  | (Tracked & {
      readonly kind: "waiting-tool"
      readonly wait: JobWait
      readonly request: ToolRequest
    })
  | (Explained & {
      readonly kind: "waiting-review"
      readonly pauseKey: string
    })
  | (Explained & { readonly kind: "paused-before-operation" })
  | (Tracked & {
      readonly kind: "paused-program"
      readonly wait: JobWait
      /** Null when no compiled pause explains the line (or the job is not this window's). */
      readonly point: PausePoint | null
      readonly operation: Operation | null
    })
  | (Tracked & {
      readonly kind: "held"
      readonly wait: JobWait | null
    })
  | (Tracked & {
      readonly kind: "finishing"
      /** Bed cleaning runs after the program. */
      readonly cleaning: boolean
    })
  | (Tracked & { readonly kind: "ended"; readonly outcome: JobOutcome })

export type JobViewKind = JobView["kind"]
export type JobViewOf<TKind extends JobViewKind> = Extract<
  JobView,
  { kind: TKind }
>
export type ActiveJobView = Exclude<JobView, { kind: "idle" }>

const IDLE: JobView = { kind: "idle" }

const operationById = (plate: Plate, id: string) =>
  plate.operations.find((operation) => operation.id === id) ?? null

/** "Part 2 of 3" for a program sent as parts; null when it is sent whole. */
export function partLabel(job: JobState): string | null {
  const count = programParts(job.program).length
  return count > 1 ? `Part ${job.part + 1} of ${count}` : null
}

function transferPercent(job: JobState): number | null {
  const { uploadedBytes, verifiedBytes, totalBytes } = job.transfer
  if (!totalBytes) return null
  if (job.phase === "uploading") return (100 * uploadedBytes) / totalBytes
  if (job.phase === "verifying") return (100 * verifiedBytes) / totalBytes
  return null
}

/**
 * The compiled pause the machine waits at: the latest point at or before the reported line
 * + 1 (the player may report the line before it). A dialect pause line after that point, such
 * as an M600 written in the NC itself, is a different pause that no compiled point explains.
 */
export function pausePointAt(
  points: readonly PausePoint[],
  pauseLines: readonly number[],
  line: number
): PausePoint | null {
  let found: PausePoint | null = null
  for (const point of points) {
    if (point.line > line + 1) break
    found = point
  }
  if (!found) return null
  const at = found.line
  return pauseLines.some((pause) => pause > at && pause <= line + 1)
    ? null
    : found
}

/** Identifies one wait at one pause, so a review reads the height map once per pause. */
export const pauseKey = (job: JobState, wait: JobWait) =>
  `${job.id}:${wait.line ?? "-"}:${wait.since}`

function toolRequest(
  session: JobSession | null,
  number: number | null
): ToolRequest {
  const entry =
    number === null
      ? null
      : (session?.plate.tools.find((tool) => tool.number === number) ?? null)
  const tool = entry?.toolId
    ? (session?.tools.find((item) => item.id === entry.toolId) ?? null)
    : null
  return { number, entry, tool }
}

function pausedView(tracked: Tracked, wait: JobWait | null): JobView {
  if (wait?.reason === "tool-change")
    return {
      ...tracked,
      kind: "waiting-tool",
      wait,
      request: toolRequest(tracked.session, wait.requestedTool),
    }
  if (wait?.reason !== "program-pause")
    return { ...tracked, kind: "held", wait }
  const { job, session } = tracked
  const point =
    session && wait.line !== null
      ? pausePointAt(
          session.compiled.pausePoints,
          job.program.pauseLines,
          wait.line
        )
      : null
  const operation =
    session && point ? operationById(session.plate, point.operationId) : null
  if (!session || !point || point.reason === "program")
    return { ...tracked, kind: "paused-program", wait, point, operation }
  const explained: Explained = { job, session, wait, point, operation }
  return point.reason === "review"
    ? { ...explained, kind: "waiting-review", pauseKey: pauseKey(job, wait) }
    : { ...explained, kind: "paused-before-operation" }
}

/** Pure: the Job tab's state from this window's Run session and the machine snapshot. */
export function deriveJobView(
  session: JobSession | null,
  snapshot: MachineSnapshot
): JobView {
  const job = snapshot.job
  if (!job) return IDLE
  const tracked: Tracked = {
    job,
    session: session?.runId === job.id ? session : null,
  }
  const transferring = (step: TransferStep): JobView => ({
    ...tracked,
    kind: "transferring",
    step,
    percent: transferPercent(job),
  })
  switch (job.phase) {
    case "starting":
      // A program sent as parts keeps running while its next part starts.
      return job.progress
        ? { ...tracked, kind: "running" }
        : transferring(job.phase)
    case "preparing":
    case "uploading":
    case "verifying":
      return transferring(job.phase)
    case "running":
      return { ...tracked, kind: "running" }
    case "paused":
      return pausedView(tracked, job.wait)
    case "finishing":
    case "cleaning":
      return {
        ...tracked,
        kind: "finishing",
        cleaning: job.phase === "cleaning",
      }
    case "completed":
    case "stopped":
    case "failed":
    case "unverified":
    case "lost":
      return { ...tracked, kind: "ended", outcome: job.phase }
  }
}

/** The plate the Job tab shows: this window's job as it was run, else the selected plate. */
export type JobSubject = {
  readonly plate: Plate
  readonly compiled: CompiledPlate
  /** A job's library tools as they were at Run; the selected plate uses the library's. */
  readonly tools?: readonly Tool[]
  /** The plan a job's Run was sent with; the selected plate has none. */
  readonly plan?: MotionPlan | null
}

export function jobSubject(
  view: JobView,
  selected: JobSubject | null
): JobSubject | null {
  if (view.kind !== "idle" && view.session) return view.session
  return selected
}

/** A compiled program's lines, split once per program. */
const programLines = new WeakMap<CompiledPlate, readonly string[]>()

const linesOf = (compiled: CompiledPlate) => {
  let lines = programLines.get(compiled)
  if (!lines) {
    lines = compiled.program.source.split(/\r?\n/)
    programLines.set(compiled, lines)
  }
  return lines
}

/** Whether a program line does anything: not blank, nor only comments. */
const executes = (text: string) =>
  text.replace(/\([^)]*\)|;.*$/g, "").trim() !== ""

/**
 * The furthest line a job is known to play: the line it reports, or, once it resumed from a
 * program pause, the first line after the pause that does anything. The reported line moves
 * only with feed moves (G1, G2, G3), so after a pause it stays on the line before it until the
 * next one, while probing, rapids and tool changes run. Null before the job reports progress.
 */
export function playedLine(
  job: JobState,
  subject: Pick<JobSubject, "compiled"> | null
): number | null {
  const reported = job.progress?.line ?? null
  const resumed = job.resumedLine
  if (resumed === null || !subject) return reported
  const lines = linesOf(subject.compiled)
  let line = resumed
  while (line < lines.length && !executes(lines[line - 1])) line += 1
  return Math.max(reported ?? 0, Math.min(line, lines.length))
}

/** Where this window's job is, for the timeline to follow; null before it reports progress. */
export type FollowTarget = {
  readonly jobId: string
  readonly line: number
  /** False once the job ended: its last reported line stays on show until Dismiss. */
  readonly active: boolean
}

export function followTarget(view: JobView): FollowTarget | null {
  if (view.kind === "idle" || !view.session || !view.job.progress) return null
  return {
    jobId: view.job.id,
    line: playedLine(view.job, view.session) ?? view.job.progress.line,
    active: view.kind !== "ended",
  }
}

export type ProgramPosition = {
  readonly operation: Operation | null
  readonly section: CompiledSection | null
}

/** The operation and section a compiled program line belongs to. */
export function programPosition(
  subject: JobSubject,
  line: number
): ProgramPosition {
  const span = subject.compiled.spans.find(
    (item) => line >= item.startLine && line <= item.endLine
  )
  let section: CompiledSection | null = null
  for (const item of subject.compiled.sections) {
    if (item.startLine > line) break
    if (item.endLine >= line) section = item
  }
  return {
    operation: span ? operationById(subject.plate, span.operationId) : null,
    section,
  }
}

/**
 * A program position as the Job tab names it, the job's position and the timeline's markers
 * alike: its operation and section ("Isolation · Toolpath 1"), or whichever of them is known;
 * null for neither.
 */
export function positionLabel(
  operation: Pick<Operation, "name"> | null,
  section: Pick<CompiledSection, "name"> | null
): string | null {
  const parts = [operation?.name, section?.name].filter((part) => !!part)
  return parts.length ? parts.join(" · ") : null
}

export type JobStatusTone = "default" | "secondary" | "outline" | "destructive"

/** A compact description of a job for badges. */
export type JobStatus = {
  readonly label: string
  readonly tone: JobStatusTone
  /** The job waits for the user. */
  readonly attention: boolean
}

const TRANSFER_STEP_LABELS: Record<TransferStep, string> = {
  preparing: "Preparing",
  uploading: "Uploading",
  verifying: "Verifying",
  starting: "Starting",
}

const OUTCOME_LABELS: Record<JobOutcome, string> = {
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
  unverified: "Unverified",
  lost: "Connection lost",
}

const OUTCOME_TONES: Record<JobOutcome, JobStatusTone> = {
  completed: "secondary",
  stopped: "outline",
  failed: "destructive",
  unverified: "destructive",
  lost: "destructive",
}

const withPercent = (label: string, percent: number | null) =>
  percent === null ? label : `${label} · ${Math.floor(percent)}%`

export function jobStatus(view: JobView): JobStatus {
  switch (view.kind) {
    case "idle":
      return { label: "No job", tone: "outline", attention: false }
    case "transferring": {
      const part = partLabel(view.job)
      const step = TRANSFER_STEP_LABELS[view.step]
      return {
        label: withPercent(
          part && view.step !== "preparing" && view.step !== "starting"
            ? `${step} ${part.toLowerCase()}`
            : step,
          view.percent
        ),
        tone: "secondary",
        attention: false,
      }
    }
    case "running":
      return {
        label: withPercent("Running", view.job.progress?.percent ?? null),
        tone: "secondary",
        attention: false,
      }
    case "waiting-tool":
      return {
        label:
          view.request.number === null
            ? "Tool change"
            : `Install T${view.request.number}`,
        tone: "default",
        attention: true,
      }
    case "waiting-review":
      return { label: "Review height map", tone: "default", attention: true }
    case "paused-before-operation":
      return {
        label: "Paused before operation",
        tone: "default",
        attention: true,
      }
    case "paused-program":
      return { label: "Program pause", tone: "default", attention: true }
    case "held":
      return { label: "Paused", tone: "default", attention: true }
    case "finishing":
      return {
        label: view.cleaning ? "Cleaning bed" : "Finishing",
        tone: "secondary",
        attention: false,
      }
    case "ended":
      return {
        label: OUTCOME_LABELS[view.outcome],
        tone: OUTCOME_TONES[view.outcome],
        attention: false,
      }
  }
}
