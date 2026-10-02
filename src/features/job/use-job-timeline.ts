import { useEffect, useRef, useState } from "react"
import {
  machineProgram,
  programPositionOf,
} from "@/app/workspace/machine-program"
import type { PlayheadSource } from "@/components/workspace/bed-viewer"
import type { ShownPlayhead } from "@/components/workspace/viewer/viewer-input"
import { revealedSegments } from "@/components/workspace/viewer/toolpath-buffers"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { GCodeProgram, Point3 } from "@/domain/nc/gcode"
import {
  moveTimes,
  playheadAt,
  positionAt,
  timeAfterMoves,
  timeAtPosition,
} from "@/domain/nc/move-times"
import type { MoveTimes } from "@/domain/nc/move-times"
import type { Plate } from "@/domain/plate/plate"
import type { Telemetry } from "@/machine/contract"
import { useFreshTelemetry } from "@/platform/machine"
import {
  buildPreviewTimeline,
  previewAt,
  stepForLine,
  stepForMove,
} from "./preview-timeline"
import type { PreviewTimeline } from "./preview-timeline"
import type { FollowTarget, JobSubject } from "./job-view"

const EMPTY_TIMELINE: PreviewTimeline = { steps: [], ticks: [], probePoints: 0 }

/**
 * How often, at most, the step on show follows simulated playback: the timeline, the G-code and
 * the cut facts, which render with the Job tab. The 3D view follows every frame on its own.
 */
const STEP_INTERVAL_MS = 100

/**
 * Following a job under way, the playhead goes to where each report puts the machine over about
 * the time until the next report, one report behind it: in no less or more time than these.
 */
const REPLAY_MS = { least: 100, most: 2000 } as const

/**
 * How far (s of the program's moves) the playhead goes to where a report places the machine at
 * once, rather than along the moves: the follow lost the machine for that long, or a report
 * corrected where it was placed.
 */
const SNAP_SECONDS = 2

/** How fast, at most, the playhead catches up along the moves, in seconds of them per second. */
const CATCH_UP_RATE = 2

/**
 * How far (mm) a report may put the tool off the program's moves before it is drawn where the
 * machine reported it, such as where a probe touched before the plate's model has it touch; and
 * how near it then comes again (`NEAR_REPORTS`) to be drawn on them, so that a reading about as
 * far off does not switch between both.
 */
const OFF_MOVES_MM = { enter: 1.5, leave: 0.5 } as const

/** Reports in a row near the moves again (`OFF_MOVES_MM`) that put the tool back on them. */
const NEAR_REPORTS = 2

/** A followed job's latest report: the machine's line and positions. */
type LiveReport = {
  readonly jobId: string
  readonly line: number
  readonly telemetry: Telemetry
}

/** The playhead's way to where the latest report put the machine, in the program's time. */
type Replay = {
  /** Where the playhead was when the report came, and where the report put the machine. */
  readonly from: number
  readonly to: number
  /** When it set out (`performance.now()`) and how long it takes, in milliseconds. */
  readonly startedAt: number
  readonly span: number
  /** The report's time (`Telemetry.receivedAt`). */
  readonly receivedAt: number
  /** Where the tool is drawn on its way to where the report put it off the moves; null on them. */
  readonly tip: { readonly from: Point3; readonly to: Point3 } | null
}

/** How far along its way a replay is at `now`, from 0 to 1. */
const replayShare = ({ startedAt, span }: Replay, now: number) =>
  span > 0 ? Math.min(1, Math.max(0, (now - startedAt) / span)) : 1

const replayTime = (replay: Replay, now: number) =>
  replay.from + (replay.to - replay.from) * replayShare(replay, now)

function replayTip(replay: Replay, now: number): Point3 | undefined {
  const { tip } = replay
  if (!tip) return undefined
  const share = replayShare(replay, now)
  return [
    tip.from[0] + (tip.to[0] - tip.from[0]) * share,
    tip.from[1] + (tip.to[1] - tip.from[1]) * share,
    tip.from[2] + (tip.to[2] - tip.from[2]) * share,
  ]
}

const distance = (a: Point3, b: Point3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Where a followed job's last report placed the machine, which the next report goes on from. */
type Placed = {
  /** When, in the program's moves (`timeAtPosition`). */
  readonly time: number
  /** The furthest line the job reported. */
  readonly line: number
  /** Off the moves (`OFF_MOVES_MM`), where the tool is drawn: where it was reported; else null. */
  readonly tip: Point3 | null
  /** Reports in a row that put it near the moves again while off them. */
  readonly near: number
  /** The report's time (`Telemetry.receivedAt`). */
  readonly receivedAt: number
}

/**
 * Where the last report placed each job this window follows, by job id: the Job tab mounted
 * anew, such as after another tab, goes on from there rather than from the reported line, which
 * may lag back to a place the job went through before. Dismissing the job forgets it.
 */
const placedJobs = new Map<string, Placed>()

/** Forgets where reports placed this window's jobs, as Dismiss ends the job's Run session. */
export const forgetPlacedJobs = () => placedJobs.clear()

/** A followed job's plate, and the moves its machine makes (`machineProgram`), timed. */
type FollowedMoves = {
  readonly plate: Plate
  readonly machine: GCodeProgram
  readonly timed: MoveTimes
}

/**
 * Where a report puts the machine's tool in the plate's program: by its machine position, and
 * by its work position, which the program's own moves are in.
 */
function reportedPositions(
  plate: Plate,
  { machine, work, toolOffset }: Telemetry
): Point3[] {
  const positions: Point3[] = []
  // A tool longer than the one work Z was set with has its tip lower by the difference.
  const tip =
    machine &&
    programPositionOf(plate, [
      machine.x,
      machine.y,
      machine.z - (toolOffset ?? 0),
    ])
  if (tip) positions.push(tip)
  if (work) positions.push([work.x, work.y, work.z])
  return positions
}

/** Where a report places the machine, going on from where the job's last report placed it. */
function placeReport(
  { plate, machine, timed }: FollowedMoves,
  last: Placed | null,
  { line, telemetry }: LiveReport
): Placed {
  const positions = reportedPositions(plate, telemetry)
  const furthest = Math.max(line, last?.line ?? 0)
  const time = timeAtPosition(
    machine,
    timed,
    {
      line: furthest,
      positions,
      tool: telemetry.tool,
      requestedTool: telemetry.requestedTool,
    },
    last && {
      time: last.time,
      since: Math.max(0, (telemetry.receivedAt - last.receivedAt) / 1000),
    }
  )
  // Off the moves by more than either reading allows, the tool is drawn where the report has it,
  // until reports in a row put it near them again.
  const onMoves = positionAt(machine, timed, time)
  const reported = positions.at(0)
  const away =
    onMoves && reported
      ? Math.min(...positions.map((at) => distance(at, onMoves)))
      : 0
  const near = last?.tip && away <= OFF_MOVES_MM.leave ? last.near + 1 : 0
  const off = last?.tip ? near < NEAR_REPORTS : away > OFF_MOVES_MM.enter
  return {
    time,
    line: furthest,
    tip: off && reported ? reported : null,
    near: off ? near : 0,
    receivedAt: telemetry.receivedAt,
  }
}

/** Whether the tool changes along the moves between two times of the program. */
function toolChangesBetween(
  { machine, timed }: FollowedMoves,
  from: number,
  to: number
) {
  const first = playheadAt(timed, Math.min(from, to)).segment
  const last = playheadAt(timed, Math.max(from, to)).segment
  const { segments } = machine
  for (let index = first + 1; index <= last; index++)
    if (segments[index].tool !== segments[first].tool) return true
  return false
}

/**
 * From where the playhead is, the way to where a report placed the machine: on to it, one report
 * behind, over about the time until the next report and at most `CATCH_UP_RATE` times as fast
 * as the moves; at once when it is far ahead (`SNAP_SECONDS`) or past a tool change, or far
 * behind. A little behind where it is shown, and anywhere behind off the moves, which the report
 * cannot place well, the playhead waits there for the machine.
 */
function replayTo(
  moves: FollowedMoves,
  previous: Replay | null,
  placed: Placed,
  now: number
): Replay {
  const { machine, timed } = moves
  const { time, tip, receivedAt } = placed
  const shown = previous ? replayTime(previous, now) : time
  // Off the moves, the tool goes to where the report has it from where it is drawn.
  const drawn =
    (previous && replayTip(previous, now)) ??
    positionAt(machine, timed, shown) ??
    tip
  const way = (from: number, to: number, span: number): Replay => ({
    from,
    to,
    startedAt: now,
    span,
    receivedAt,
    tip: tip && { from: drawn ?? tip, to: tip },
  })
  if (!previous) return way(time, time, 0)
  const ahead = time - shown
  const far = Math.abs(ahead) > SNAP_SECONDS
  if (ahead > 0 ? far || toolChangesBetween(moves, shown, time) : far && !tip)
    return way(time, time, 0)
  const interval = Math.min(
    REPLAY_MS.most,
    Math.max(REPLAY_MS.least, receivedAt - previous.receivedAt)
  )
  if (ahead <= 0) return way(shown, shown, interval)
  return way(shown, time, Math.max(interval, (ahead / CATCH_UP_RATE) * 1000))
}

type Playback = {
  /** The program the position belongs to; another program starts over, fully shown. */
  readonly program: GCodeProgram | null
  /** Fractional timeline step; null shows the whole program. While simulating, the move's. */
  readonly position: number | null
  /** Playback simulates the machine's moves, playing or paused; its time is not state. */
  readonly simulating: boolean
  readonly playing: boolean
  /** The job the user scrubbed away from; any other job is followed again. */
  readonly detachedFrom: string | null
}

const initialPlayback = (program: GCodeProgram | null): Playback => ({
  program,
  position: null,
  simulating: false,
  playing: false,
  detachedFrom: null,
})

const clampStep = (step: number, count: number) =>
  Math.max(0, Math.min(count, Number.isNaN(step) ? 0 : step))

/** Where simulated playback is, which the 3D view follows every frame (`PlayheadSource`). */
class PlayheadStore implements PlayheadSource {
  private playhead: ShownPlayhead | null = null
  private readonly listeners = new Set<() => void>()
  readonly get = () => this.playhead
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(playhead: ShownPlayhead | null) {
    this.playhead = playhead
    for (const listener of this.listeners) listener()
  }
}

/** What the 3D viewer draws at the cursor: the program up to a line. */
export type TimelinePreview = ReturnType<typeof previewAt>

export type JobTimeline = {
  readonly timeline: PreviewTimeline
  /** Timeline step on show. */
  readonly cursor: number
  /** The program line on show: the machine's own line while following, 0 for none. */
  readonly line: number
  readonly preview: TimelinePreview
  /**
   * Where simulated playback is along the machine's moves, which the 3D view follows; while
   * `live`, where the machine is.
   */
  readonly playhead: PlayheadSource
  readonly playing: boolean
  readonly speed: number
  /** This window's job position, while it has one. */
  readonly target: FollowTarget | null
  /** The cursor follows the target; false once the user scrubs away from it. */
  readonly following: boolean
  /** Following a job under way: the playhead follows the machine along the program's moves. */
  readonly live: boolean
  seek: (step: number) => void
  seekLine: (line: number) => void
  togglePlay: () => void
  setSpeed: (speed: number) => void
  /** Back to live: the cursor follows the machine again. */
  follow: () => void
}

/**
 * The preview cursor of the Job tab over the subject's program. Without a job it scrubs by line
 * and plays the program as the machine moves it, each move at its feed (`moveTimes`), times the
 * playback speed: the 3D view follows the moves every frame (`playhead`), while the step on show
 * follows a few times a second, so the tab does not render every frame. While this window's job
 * reports progress it follows the machine's line until the user scrubs; while the job is under
 * way the playhead goes along the moves that line leaves in reach to where each report places the
 * machine (`timeAtPosition`), over about the time until the next, so it follows one report
 * behind (`replayTo`), and the line on show is the one it is on.
 */
export function useJobTimeline(
  subject: Pick<JobSubject, "plate" | "compiled"> | null,
  target: FollowTarget | null
): JobTimeline {
  const program = subject?.compiled.program ?? null
  // Built once per compiled program, from its sections and pause points.
  const timeline = subject
    ? buildPreviewTimeline(
        subject.compiled,
        subject.plate.operations,
        kitForPlate(subject.plate)
      )
    : EMPTY_TIMELINE
  // The moves as the machine makes them, which playback simulates; both are cached.
  const machine = subject
    ? machineProgram(subject.plate, subject.compiled.program)
    : null
  const timed = machine ? moveTimes(machine) : null
  const count = timeline.steps.length
  const [speed, setSpeed] = useState(1)
  const [stored, setPlayback] = useState(() => initialPlayback(program))
  // Simulated time and the playhead move every frame, apart from the Job tab's state.
  const [playhead] = useState(() => new PlayheadStore())
  const time = useRef<number | null>(null)
  const playback =
    stored.program === program ? stored : initialPlayback(program)
  const following = target !== null && playback.detachedFrom !== target.jobId
  // Following the machine ends preview playback, so it cannot resume on its own afterwards.
  if (following && (stored.playing || stored.simulating))
    setPlayback({ ...stored, playing: false, simulating: false })
  const simulating = playback.simulating && !following
  const playing = playback.playing && simulating
  const telemetry = useFreshTelemetry()
  const plate = subject?.plate ?? null
  const live =
    following && target.active && !!machine?.segments.length && !!timed
  const liveJob = live ? target.jobId : null
  const liveReport: LiveReport | null =
    live && telemetry
      ? { jobId: target.jobId, line: target.line, telemetry }
      : null
  // The step and line the playhead is on while it follows the machine, a few times a second.
  const [liveStep, setLiveStep] = useState<{
    jobId: string
    step: number
    line: number
  } | null>(null)
  const shownLive = liveStep && liveStep.jobId === liveJob ? liveStep : null
  let cursor = Math.floor(clampStep(playback.position ?? count, count))
  if (following)
    cursor = shownLive ? shownLive.step : stepForLine(timeline, target.line)
  const preview: TimelinePreview = program
    ? previewAt(timeline, cursor, program)
    : { line: 0, probePoint: undefined, segmentProgress: 0 }
  // The whole program on show has no line of its own until the user moves the cursor.
  let line = preview.line
  // The reported line stays on the last feed move while the machine's rapids and routines run.
  if (following) line = Math.max(target.line, shownLive?.line ?? 0)
  else if (playback.position === null && !simulating) line = 0

  // A simulation that ended, or of another program, shows no playhead.
  useEffect(() => {
    if (simulating) return
    time.current = null
    playhead.set(null)
  }, [simulating, program, playhead])

  // The latest report, which the loop below reads every frame.
  const report = useRef<LiveReport | null>(null)
  useEffect(() => {
    report.current = liveReport
  })

  useEffect(() => {
    if (!liveJob || !plate || !machine || !timed) return
    const moves: FollowedMoves = { plate, machine, timed }
    // Followed before, it goes on from where the last report placed the job.
    const placed = placedJobs.get(liveJob)
    let replay: Replay | null = placed
      ? {
          from: placed.time,
          to: placed.time,
          startedAt: performance.now(),
          span: 0,
          receivedAt: placed.receivedAt,
          tip: placed.tip && { from: placed.tip, to: placed.tip },
        }
      : null
    let shownTime: number | null = null
    let shownTip: Point3 | undefined
    let shownStep: number | null = null
    let shownLine: number | null = null
    let steppedAt = -Infinity
    let frame = 0
    const tick = (now: number) => {
      const latest = report.current
      if (
        latest?.jobId === liveJob &&
        latest.telemetry.receivedAt !== replay?.receivedAt
      ) {
        const next = placeReport(moves, placedJobs.get(liveJob) ?? null, latest)
        placedJobs.set(liveJob, next)
        replay = replayTo(moves, replay, next, now)
      }
      if (replay) {
        const seconds = replayTime(replay, now)
        const at = playheadAt(timed, seconds)
        const tip = replayTip(replay, now)
        if (
          seconds !== shownTime ||
          tip?.join() !== shownTip?.join() ||
          !playhead.get()
        ) {
          shownTime = seconds
          shownTip = tip
          playhead.set(tip ? { ...at, tip } : at)
        }
        const segment = machine.segments[at.segment]
        const step = stepForMove(timeline, segment)
        if (
          (step !== shownStep || segment.line !== shownLine) &&
          now - steppedAt >= STEP_INTERVAL_MS
        ) {
          shownStep = step
          shownLine = segment.line
          steppedAt = now
          setLiveStep({ jobId: liveJob, step, line: segment.line })
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      playhead.set(null)
    }
  }, [liveJob, plate, machine, timed, timeline, playhead])

  /** The step that shows the move under way `seconds` into the machine's moves. */
  const stepAt = (seconds: number) => {
    if (!timed || !machine) return 0
    const { segment } = playheadAt(timed, seconds)
    return stepForMove(timeline, machine.segments[segment])
  }
  const update = (patch: Partial<Omit<Playback, "program">>) =>
    setPlayback((current) => ({
      ...(current.program === program ? current : initialPlayback(program)),
      ...patch,
    }))
  const stop = () => {
    time.current = null
    playhead.set(null)
  }
  const seek = (step: number) => {
    stop()
    update({
      position: clampStep(step, count),
      simulating: false,
      playing: false,
      detachedFrom: target?.jobId ?? null,
    })
  }

  useEffect(() => {
    if (!playing || !timed || !machine) return
    let last = performance.now()
    let shown = -Infinity
    let frame = 0
    const tick = (now: number) => {
      const next = (time.current ?? 0) + ((now - last) / 1000) * speed
      last = now
      // At the end the whole program shows again.
      if (next >= timed.duration) {
        time.current = null
        playhead.set(null)
        setPlayback((current) =>
          current.program === program
            ? { ...current, position: count, simulating: false, playing: false }
            : current
        )
        return
      }
      time.current = next
      const at = playheadAt(timed, next)
      playhead.set(at)
      if (now - shown >= STEP_INTERVAL_MS) {
        shown = now
        const step = stepForMove(timeline, machine.segments[at.segment])
        setPlayback((current) =>
          current.program !== program || current.position === step
            ? current
            : { ...current, position: step }
        )
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, program, timed, machine, timeline, count, speed, playhead])

  return {
    timeline,
    cursor,
    line,
    preview,
    playhead,
    playing,
    speed,
    target,
    following,
    live,
    seek,
    seekLine: (programLine) => seek(stepForLine(timeline, programLine)),
    togglePlay: () => {
      if (playing) {
        const paused = time.current
        update({
          playing: false,
          ...(paused === null ? {} : { position: stepAt(paused) }),
        })
        return
      }
      if (!timed || !machine || !count) return
      // A paused simulation resumes; otherwise it starts after the moves on show, as the 3D
      // view reveals them for the step (a grid's sample, on its line), or over.
      let start = simulating ? time.current : null
      if (start === null) {
        const step =
          cursor > 0 && cursor < count ? timeline.steps[cursor - 1] : null
        const shown = step
          ? revealedSegments(machine, 100, step.line, step.probePoint)
          : 0
        start = timeAfterMoves(timed, shown)
      }
      time.current = start
      playhead.set(playheadAt(timed, start))
      update({
        position: stepAt(start),
        simulating: true,
        playing: true,
        detachedFrom: target?.jobId ?? null,
      })
    },
    setSpeed,
    follow: () => {
      stop()
      update({ playing: false, simulating: false, detachedFrom: null })
    },
  }
}
