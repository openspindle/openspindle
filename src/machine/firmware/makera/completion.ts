import { isTerminalJobPhase } from "../../contract/index.ts"
import type {
  JobFault,
  JobPhase,
  JobWait,
  PreparedProgram,
  Telemetry,
} from "../../contract/index.ts"
import type { CompletionTracker, CompletionUpdate, Line } from "../adapter.ts"
import { MakeraMeasurements } from "./measurements.ts"

const MAX_FAULTS = 50
/** The firmware keeps its done snapshot for one second, then drops P. */
const FINISHING_OVERDUE_MS = 30_000
const CLEANING_OVERDUE_MS = 180_000
/** A play the machine never reports as running is abandoned after this long. */
const START_LIMIT_MS = 30_000

const idleAndStopped = (telemetry: Telemetry) =>
  telemetry.state === "Idle" &&
  telemetry.spindleOn !== true &&
  (telemetry.spindleRpm ?? 0) === 0

/**
 * Player.cpp lifecycle: while playing, status carries P:line,percent,elapsed with a rounded
 * percentage. After the last block the player reports a done snapshot (percent 100, line =
 * requested lines) for about a second, then P disappears. An abort reports its own snapshot
 * for three polls. So a job is complete only when P disappears after the done snapshot,
 * with the machine idle and no abort or halt evidence; bed cleaning then runs after it.
 */
export class MakeraCompletion implements CompletionTracker {
  private phase: JobPhase = "starting"
  private progress: Telemetry["job"] = null
  private resumedLine: number | null = null
  private wait: JobWait | null = null
  private readonly faults: JobFault[] = []
  private readonly measured = new MakeraMeasurements()
  private error: string | null = null
  private overdue = false
  private streamSeen = false
  private doneSeen = false
  private cleaningDone = false
  private abortEvidence: string | null = null
  private stopRequestedAt: number | null = null
  private pauseRequestedAt: number | null = null
  private finishingSince: number | null = null
  private readonly lineCount: number
  private readonly pauseLines: ReadonlySet<number>
  private readonly bedClean: boolean | null
  private readonly now: () => number
  private readonly createdAt: number

  constructor(
    program: PreparedProgram,
    bedClean: boolean | null,
    now: () => number
  ) {
    this.lineCount = program.lineCount
    this.pauseLines = new Set(program.pauseLines)
    this.bedClean = bedClean
    this.now = now
    this.createdAt = now()
  }

  get streaming() {
    return !isTerminalJobPhase(this.phase)
  }

  get update(): CompletionUpdate {
    return {
      phase: this.phase,
      progress: this.progress,
      resumedLine: this.resumedLine,
      wait: this.wait,
      faults: this.faults,
      measurements: this.measured.list,
      overdue: this.overdue,
      error: this.error,
      // The done snapshot lasts a second once the rounded percentage reaches 100.
      nearEnd: (this.progress?.percent ?? 0) >= 99,
    }
  }

  status(telemetry: Telemetry): CompletionUpdate {
    if (isTerminalJobPhase(this.phase)) return this.update
    if (telemetry.state === "Alarm" || telemetry.state === "Sleep") {
      this.abortEvidence ??=
        telemetry.alarm === null
          ? `The machine entered ${telemetry.state}`
          : `The machine entered ${telemetry.state} (halt reason ${telemetry.alarm})`
      this.settleAborted()
      return this.update
    }
    if (telemetry.job) this.playing(telemetry, telemetry.job)
    else if (this.streamSeen) this.stopped(telemetry)
    return this.update
  }

  line(line: Line, telemetry: Telemetry | null): CompletionUpdate {
    if (isTerminalJobPhase(this.phase)) return this.update
    this.measured.read(line.text, telemetry, this.now())
    switch (line.kind) {
      case "halt":
      case "abort":
        this.abortEvidence ??= line.text
        break
      case "automation-done":
        // Tool changes print the same line; only the one after the done snapshot ends cleaning.
        if (this.doneSeen) this.cleaningDone = true
        break
      case "error":
      case "alarm":
      case "job-fault":
        if (this.faults.length < MAX_FAULTS)
          this.faults.push({
            at: this.now(),
            line: telemetry?.job?.line ?? this.progress?.line ?? null,
            message: line.text,
          })
        break
      case "ack":
      case "rejection":
      case "info":
        break
    }
    return this.update
  }

  pauseRequested() {
    this.pauseRequestedAt = this.now()
  }

  stopRequested() {
    this.stopRequestedAt = this.now()
  }

  disconnected(): CompletionUpdate {
    if (!isTerminalJobPhase(this.phase)) {
      this.phase = "lost"
      this.wait = null
      this.error =
        "Connection lost. The job may still be running on the machine; check it before reconnecting."
    }
    return this.update
  }

  tick(now: number): CompletionUpdate {
    if (this.phase === "starting" && now - this.createdAt > START_LIMIT_MS)
      this.finish(
        "unverified",
        "The machine never reported the program running. Check the machine before running again."
      )
    if (this.phase === "finishing" || this.phase === "cleaning") {
      this.finishingSince ??= now
      const limit =
        this.phase === "cleaning" ? CLEANING_OVERDUE_MS : FINISHING_OVERDUE_MS
      this.overdue = now - this.finishingSince > limit
    }
    return this.update
  }

  private playing(
    telemetry: Telemetry,
    progress: NonNullable<Telemetry["job"]>
  ) {
    this.streamSeen = true
    this.progress = progress
    if (progress.percent === 100 && progress.line >= this.lineCount)
      this.doneSeen = true
    switch (telemetry.state) {
      case "Tool":
        this.pause("tool-change", progress.line, telemetry.requestedTool)
        return
      case "Pause":
        this.pause(this.pauseReason(progress.line), progress.line, null)
        return
      case "Hold":
        this.pause("hold", progress.line, null)
        return
      case "Wait":
        // Suspending: the queue drains before the machine reports Pause.
        return
      default:
        if (this.wait?.reason === "program-pause")
          this.resumedLine = this.pauseLine(this.wait.line) + 1
        this.wait = null
        this.pauseRequestedAt = null
        this.phase = this.doneSeen ? "finishing" : "running"
    }
  }

  private pauseReason(line: number): JobWait["reason"] {
    if (this.pauseRequestedAt !== null) return "hold"
    // Suspended by an M600, the player reports the line before it: suspend_command saves
    // the lines played so far, and the M600 counts once it returns.
    if (this.pauseLines.has(line) || this.pauseLines.has(line + 1))
      return "program-pause"
    return "hold"
  }

  /** The program pause a wait reported at `line` is at: the line after it, else the line. */
  private pauseLine(line: number | null): number {
    if (line === null) return 0
    return this.pauseLines.has(line + 1) ? line + 1 : line
  }

  private pause(
    reason: JobWait["reason"],
    line: number,
    requestedTool: number | null
  ) {
    this.phase = "paused"
    if (this.wait?.reason === reason && this.wait.line === line) return
    this.wait = { reason, line, requestedTool, since: this.now() }
  }

  /** P disappeared after the stream had started. */
  private stopped(telemetry: Telemetry) {
    this.wait = null
    if (this.abortEvidence || !this.doneSeen) {
      if (this.abortEvidence) this.settleAborted()
      else
        this.finish(
          "unverified",
          "Program progress disappeared without the machine's completion report. Check the machine."
        )
      return
    }
    const cleaning = telemetry.bedCleanAuto ?? this.bedClean
    if (cleaning && !this.cleaningDone) {
      this.phase = "cleaning"
      return
    }
    if (!idleAndStopped(telemetry)) {
      this.phase = cleaning ? "cleaning" : "finishing"
      return
    }
    if (this.faults.length)
      this.finish(
        "failed",
        `The machine reported ${this.faults.length === 1 ? "an error" : `${this.faults.length} errors`} during the program: ${this.faults[0].message}`
      )
    else this.finish("completed", null)
  }

  /** The machine's own report (an alarm or error line) explains an abort best. */
  private settleAborted() {
    if (this.stopRequestedAt !== null) {
      this.finish("stopped", null)
      return
    }
    const detail =
      this.faults.at(0)?.message ??
      this.abortEvidence ??
      "The program was aborted."
    this.finish("failed", `The machine aborted the program: ${detail}`)
  }

  private finish(phase: JobPhase, error: string | null) {
    this.phase = phase
    this.wait = null
    this.overdue = false
    this.error = error
  }
}
