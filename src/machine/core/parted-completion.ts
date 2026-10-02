import {
  fileLineOf,
  isTerminalJobPhase,
  partLineCount,
  programLineOf,
  programParts,
} from "../contract/index.ts"
import type {
  JobFault,
  JobMeasurement,
  JobPhase,
  PreparedProgram,
  ProgramPart,
  Telemetry,
} from "../contract/index.ts"
import type {
  CompletionTracker,
  CompletionUpdate,
  Line,
} from "../firmware/adapter.ts"

/** The firmware's tracker for one part's file. */
export type PartTracker = (
  program: PreparedProgram,
  bedClean: boolean | null
) => CompletionTracker

/** As many as a job reports (`JobStateSchema`). */
const MAX_MEASUREMENTS = 100

/** A part's file as a program of its own: the firmware's tracker counts its lines. */
export function partProgram(
  program: PreparedProgram,
  part: ProgramPart
): PreparedProgram {
  return {
    text: "",
    lineCount: partLineCount(part),
    bytes: part.bytes,
    pauseLines: program.pauseLines
      .filter((line) => line >= part.startLine && line <= part.endLine)
      .map((line) => fileLineOf(part, line)),
    changes: [],
    changeCount: 0,
    parts: [],
  }
}

const mapLine = (part: ProgramPart, line: number | null) =>
  line === null ? null : programLineOf(part, line)

const mapFault = (part: ProgramPart) => (fault: JobFault) => ({
  ...fault,
  line: mapLine(part, fault.line),
})

const mapMeasurement =
  (part: ProgramPart) =>
  (measurement: JobMeasurement): JobMeasurement => ({
    ...measurement,
    line: mapLine(part, measurement.line),
  })

/**
 * A program followed as one job while its parts play one after another, each followed by the
 * firmware's own tracker. Lines are the program's, progress and elapsed time run over every
 * part, and faults and measurements accumulate. When a part before the last completes, the
 * job is starting the next one until `begin` follows it: `claimNext` gives that part to one
 * start, and a part that did not start is never started again.
 */
export class PartedCompletion implements CompletionTracker {
  readonly parts: readonly ProgramPart[]
  private readonly program: PreparedProgram
  private readonly create: PartTracker
  private readonly totalBytes: number
  private index = 0
  private current: CompletionTracker | null = null
  /** What the parts before the current one reported, in program lines. */
  private readonly faults: JobFault[] = []
  private readonly measurements: JobMeasurement[] = []
  private elapsedSeconds = 0
  private playedBytes = 0
  /** Where the previous part ended, until the one playing reports progress. */
  private carried: Telemetry["job"] = null
  /** The line after the last pause a part before resumed from, in program lines. */
  private carriedResume: number | null = null
  /** How the job ended between parts, where no part's tracker follows the machine. */
  private ended: { phase: JobPhase; error: string | null } | null = null
  /** The next part went to a start; until it begins, no other start gets it. */
  private claimed = false

  constructor(program: PreparedProgram, create: PartTracker) {
    this.program = program
    this.parts = programParts(program)
    this.create = create
    this.totalBytes = this.parts.reduce((sum, part) => sum + part.bytes, 0)
  }

  /** The part followed: the one playing, or the one that just completed. */
  get part() {
    return this.index
  }

  /** A part before the last completed and the next has not begun: nothing plays. */
  private get between(): boolean {
    return (
      this.ended === null &&
      this.current?.update.phase === "completed" &&
      this.index < this.parts.length - 1
    )
  }

  /** Between parts, with no start of the next part yet. */
  get awaitingNext(): boolean {
    return this.between && !this.claimed
  }

  /** The next part's index for one start, or null when no part waits for one. */
  claimNext(): number | null {
    if (!this.awaitingNext) return null
    this.claimed = true
    return this.index + 1
  }

  /**
   * The claimed part did not start: the job ends here, unless Stop or a lost connection ended
   * it first. A failure after `begin` is the part's own tracker's.
   */
  failedToStart(error: string) {
    if (this.between) this.ended = { phase: "failed", error }
  }

  /** Follows part `index` from its play, with the bed cleaning observed before it. */
  begin(index: number, bedClean: boolean | null) {
    this.claimed = false
    const previous = this.current
    if (previous) {
      const part = this.parts[this.index]
      const { update } = previous
      this.carried = this.progress(update.progress) ?? this.carried
      this.carriedResume =
        mapLine(part, update.resumedLine) ?? this.carriedResume
      this.faults.push(...update.faults.map(mapFault(part)))
      this.measurements.push(...update.measurements.map(mapMeasurement(part)))
      this.elapsedSeconds += update.progress?.elapsedSeconds ?? 0
      this.playedBytes += part.bytes
    }
    this.index = index
    this.current = this.create(
      partProgram(this.program, this.parts[index]),
      bedClean
    )
  }

  /** Not between parts: the next part's preflight runs as before any play. */
  get streaming() {
    return !isTerminalJobPhase(this.update.phase) && !this.between
  }

  /** The part's reported progress over the whole program. */
  private progress(reported: Telemetry["job"]): Telemetry["job"] {
    if (!reported) return null
    if (this.parts.length === 1) return reported
    const part = this.parts[this.index]
    return {
      line: programLineOf(part, reported.line),
      percent: Math.min(
        100,
        (100 * (this.playedBytes + (part.bytes * reported.percent) / 100)) /
          this.totalBytes
      ),
      elapsedSeconds: this.elapsedSeconds + reported.elapsedSeconds,
    }
  }

  get update(): CompletionUpdate {
    const part = this.parts[this.index]
    const inner = this.current?.update
    const last = this.index === this.parts.length - 1
    let phase = inner?.phase ?? "starting"
    // Between parts the job is not finishing: the next part is about to start.
    if (!last && (phase === "finishing" || phase === "cleaning"))
      phase = "running"
    if (!last && phase === "completed") phase = "starting"
    if (this.ended) phase = this.ended.phase
    return {
      phase,
      progress: this.progress(inner?.progress ?? null) ?? this.carried,
      resumedLine:
        mapLine(part, inner?.resumedLine ?? null) ?? this.carriedResume,
      wait: inner?.wait
        ? { ...inner.wait, line: mapLine(part, inner.wait.line) }
        : null,
      faults: [...this.faults, ...(inner?.faults ?? []).map(mapFault(part))],
      measurements: [
        ...this.measurements,
        ...(inner?.measurements ?? []).map(mapMeasurement(part)),
      ].slice(0, MAX_MEASUREMENTS),
      overdue: inner?.overdue ?? false,
      error: this.ended?.error ?? inner?.error ?? null,
      nearEnd: inner?.nearEnd ?? false,
    }
  }

  status(telemetry: Telemetry): CompletionUpdate {
    if (this.between) {
      // Nothing plays between parts: an alarm there ends the job.
      if (telemetry.state === "Alarm" || telemetry.state === "Sleep")
        this.ended = {
          phase: "failed",
          error: `The machine entered ${telemetry.state} before part ${this.index + 2} of ${this.parts.length} started.`,
        }
    } else this.current?.status(telemetry)
    return this.update
  }

  line(line: Line, telemetry: Telemetry | null): CompletionUpdate {
    if (!this.between) this.current?.line(line, telemetry)
    return this.update
  }

  pauseRequested() {
    this.current?.pauseRequested()
  }

  /** Between parts nothing plays, so Stop ends the job there and then: no part follows. */
  stopRequested() {
    if (this.between) this.ended = { phase: "stopped", error: null }
    else this.current?.stopRequested()
  }

  disconnected(): CompletionUpdate {
    if (this.between)
      this.ended = {
        phase: "lost",
        error: `Connection lost before part ${this.index + 2} of ${this.parts.length} started. Check the machine before reconnecting.`,
      }
    else this.current?.disconnected()
    return this.update
  }

  tick(now: number): CompletionUpdate {
    if (!this.between) this.current?.tick(now)
    return this.update
  }
}
