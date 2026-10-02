import { useEffect, useMemo, useRef, useState } from "react"
import { useSelector } from "@tanstack/react-store"
import { PlaybackClock } from "@/app/job/clock"
import { FrameStore } from "@/app/job/frame"
import type { FrameSource, PlaybackFrame } from "@/app/job/frame"
import {
  frameAt,
  sameFrame,
  stepFrame,
  stepTime,
  toolOf,
} from "@/app/job/frames"
import type { FrameOptions } from "@/app/job/frames"
import { jobTrackingStore } from "@/app/job/tracking-store"
import type { JobTracking } from "@/app/job/tracking-store"
import { usePlanIndex } from "@/app/job/use-plan"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { moveTools } from "@/components/workspace/viewer/toolpath-view"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { MoveIndex } from "@/domain/motion/spaces"
import type { PlanIndex } from "@/domain/motion/types"
import type { Estimate } from "@/domain/tracking/types"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { toViewerPlate } from "@/features/viewer/viewer-plate"
import { buildPreviewTimeline, stepForLine } from "./preview-timeline"
import type { PreviewTimeline } from "./preview-timeline"
import type { FollowTarget, JobSubject } from "./job-view"

const EMPTY_TIMELINE: PreviewTimeline = { steps: [], ticks: [], probePoints: 0 }

/**
 * How often, at most, what the cursor shows follows playback or the machine: the timeline, the
 * G-code, the cut facts and the time left, which render with the Job tab. The 3D views follow
 * every frame on their own.
 */
const STEP_INTERVAL_MS = 100

/** The slowest rate the time left is reckoned at: a tenth of the plan's. */
const SLOWEST_RATE = 0.1

/** The tool in the spindle at the cursor: its number on the plate, null for the implicit tool. */
export type CursorTool = { readonly number: number | null }

/** How long the plan takes from the cursor on, and how often the user changes tools on the way. */
export type JobEta = {
  /** Seconds, at the feed override while a job is followed. */
  readonly seconds: number
  /** The manual tool changes the machine waits at, which take as long as the user does. */
  readonly toolChanges: number
  /** From where the machine is, while a job is followed; else the whole plan. */
  readonly remaining: boolean
}

/** What the cursor shows while playback or the follow moves it, a few times a second. */
type Shown = {
  /** What moved it: the job followed, or playback. */
  readonly by: string
  readonly step: number
  readonly line: number
  readonly tool: CursorTool | null
  readonly eta: JobEta | null
}

const PLAYBACK = "playback"

type Playback = {
  /** The program the position belongs to; another program starts over, fully shown. */
  readonly program: GCodeProgram | null
  /** Fractional timeline step; null shows the whole program. While simulating, the move's. */
  readonly position: number | null
  /** Playback simulates the machine's moves, playing or paused; its time is the clock's. */
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

const toolShown = (frame: PlaybackFrame | null): CursorTool | null =>
  frame && { number: frame.tool }

const sameShown = (a: Shown | null, b: Shown) =>
  !!a &&
  a.by === b.by &&
  a.step === b.step &&
  a.line === b.line &&
  a.tool?.number === b.tool?.number &&
  (a.tool === null) === (b.tool === null) &&
  a.eta?.seconds === b.eta?.seconds &&
  a.eta?.toolChanges === b.eta?.toolChanges

/** The manual tool changes the machine waits at, from move `from` on. */
const toolChangesFrom = ({ plan }: PlanIndex, from: number) =>
  plan.checkpoints.filter(
    ({ kind, after }) => kind === "tool-wait" && after >= from
  ).length

/** The whole plan's time and tool changes, as the preview shows them. */
const planEta = (index: PlanIndex): JobEta => ({
  seconds: Math.round(index.duration),
  toolChanges: toolChangesFrom(index, 0),
  remaining: false,
})

/**
 * The time left from where a followed job's frame is, at the rate the machine goes when it does:
 * its feed override, while it waits too.
 */
function remainingEta(
  index: PlanIndex,
  frame: PlaybackFrame,
  tracking: JobTracking | null
): JobEta {
  const estimate = tracking?.state.estimate
  const override = tracking?.state.last?.feed.override ?? 100
  const rate = estimate?.rate ? estimate.rate : override / 100
  return {
    seconds: Math.round(
      (index.duration - frame.time) / Math.max(rate, SLOWEST_RATE)
    ),
    toolChanges: toolChangesFrom(index, frame.move),
    remaining: true,
  }
}

/** Where a followed job is in its plan by the tracker's estimate, with the line it reported. */
function followedFrame(
  index: PlanIndex,
  estimate: Estimate,
  time: number,
  options: Omit<FrameOptions, "source" | "status">
) {
  return frameAt(index, time, {
    ...options,
    source: "live",
    status: estimate.status,
    line: Math.max(options.line ?? 0, estimate.line),
  })
}

/**
 * How many of the plan's first moves the subject's implicit tool makes, by the tools the plate
 * draws its program with (`moveTools`).
 */
function useImplicitMoves(
  subject: JobSubject | null,
  index: PlanIndex | null
): number {
  const library = useWorkspace((state) => state.tools)
  // Cached per plate, so its tool runs stay while it does.
  const runs = subject
    ? toViewerPlate(subject.plate, subject.compiled, subject.tools ?? library)
        .tools
    : null
  const program = index?.plan.program ?? null
  return useMemo(
    () => (program && runs ? moveTools(program, runs).implicitMoves : 0),
    [program, runs]
  )
}

export type JobTimeline = {
  readonly timeline: PreviewTimeline
  /** Timeline step on show. */
  readonly cursor: number
  /** The program line on show: the machine's own line while following, 0 for none. */
  readonly line: number
  /** The tool in the spindle at the cursor, as the 3D view draws it; null while it draws none. */
  readonly tool: CursorTool | null
  /** How long the plan takes from the cursor; null without a plan, or once the job ended. */
  readonly eta: JobEta | null
  /**
   * The frames of the subject's plan the 3D views draw: playback simulating the machine's moves,
   * the step on show, or while `live`, where the machine is. They change every animation frame
   * while playback or the machine moves, without the Job tab rendering; null shows the whole
   * program.
   */
  readonly frames: FrameSource
  readonly playing: boolean
  readonly speed: number
  /** This window's job position, while it has one. */
  readonly target: FollowTarget | null
  /** The cursor follows the target; false once the user scrubs away from it. */
  readonly following: boolean
  /** Following a job under way: the frames follow the machine along its plan. */
  readonly live: boolean
  seek: (step: number) => void
  seekLine: (line: number) => void
  togglePlay: () => void
  setSpeed: (speed: number) => void
  /** Back to live: the cursor follows the machine again. */
  follow: () => void
}

/**
 * The preview cursor of the Job tab over the subject's plan: the plan of the plate's machine's
 * moves, or of a Run's session the plan it was sent with (`usePlanIndex`). Without a job it scrubs
 * by line and plays the plan as the machine is timed to move through it, times the playback
 * speed. While this window's job reports progress it follows the machine until the user scrubs:
 * while the job is under way, the clock follows where the job's tracker places the machine
 * (`jobTrackingStore`) and the line on show is the one it is on. Every frame goes to `frames`,
 * which the 3D views follow on their own, while the step, line, tool and time left on show follow
 * a few times a second, so the tab does not render every frame.
 */
export function useJobTimeline(
  subject: JobSubject | null,
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
  // A Run's session is its own subject, and carries the plan the Run was sent with.
  const index = usePlanIndex(subject)
  const implicitMoves = useImplicitMoves(subject, index)
  const count = timeline.steps.length
  const [speed, setSpeed] = useState(1)
  const [stored, setPlayback] = useState(() => initialPlayback(program))
  // The frames and the clock move every animation frame, apart from the Job tab's state.
  const [frames] = useState(() => new FrameStore())
  const [clock] = useState(() => new PlaybackClock())
  const [shown, setShown] = useState<Shown | null>(null)
  const playback =
    stored.program === program ? stored : initialPlayback(program)
  const following = target !== null && playback.detachedFrom !== target.jobId
  // Following the machine ends preview playback, so it cannot resume on its own afterwards.
  if (following && (stored.playing || stored.simulating))
    setPlayback({ ...stored, playing: false, simulating: false })
  const simulating = playback.simulating && !following
  const playing = playback.playing && simulating
  const live = following && target.active && !!index?.plan.count
  const liveJob = live ? target.jobId : null
  // Playback and the follow set the frames every animation frame; otherwise the step on show does.
  const moving = live || simulating
  // A followed job that ended, or has no plan to follow it along, stays where it was last placed,
  // else on the step of its line.
  const held = following && !live
  const heldEstimate = useSelector(jobTrackingStore, (tracking) =>
    held && tracking?.jobId === target.jobId && tracking.index === index
      ? tracking.state.estimate
      : null
  )
  const heldLine = held ? target.line : 0
  const positioned = playback.position !== null
  const scrubbed = Math.floor(clampStep(playback.position ?? count, count))
  const staticFrame = useMemo(() => {
    if (!index || moving) return null
    if (held)
      return heldEstimate
        ? followedFrame(index, heldEstimate, heldEstimate.time, {
            timeline,
            implicitMoves,
            tip: heldEstimate.status === "off-plan" ? heldEstimate.tip : null,
            line: heldLine,
          })
        : stepFrame(
            index,
            timeline,
            stepForLine(timeline, heldLine),
            implicitMoves
          )
    return positioned
      ? stepFrame(index, timeline, scrubbed, implicitMoves)
      : null
  }, [
    index,
    moving,
    held,
    heldEstimate,
    heldLine,
    timeline,
    implicitMoves,
    positioned,
    scrubbed,
  ])
  useEffect(() => {
    if (!moving) frames.set(staticFrame)
  }, [moving, staticFrame, frames])

  // The line the machine reports, which the loop below reads every frame.
  const reported = useRef(0)
  useEffect(() => {
    reported.current = target?.line ?? 0
  })

  useEffect(() => {
    if (!liveJob || !index) return
    // A new follow starts where the estimate is.
    clock.set(null)
    let aheadFloor: MoveIndex | undefined
    let steppedAt = -Infinity
    let last: Shown | null = null
    let request = 0
    const tick = (stamp: number) => {
      const now = performance.timeOrigin + stamp
      const tracking = jobTrackingStore.state
      const followed =
        tracking?.jobId === liveJob && tracking.index === index
          ? tracking
          : null
      const estimate = followed?.state.estimate ?? null
      let frame: PlaybackFrame | null
      if (estimate) {
        const reading = clock.follow(index, estimate, now)
        // The path ahead only grows while the tool goes on along the moves.
        if (reading.snapped) aheadFloor = undefined
        frame = followedFrame(index, estimate, reading.time, {
          timeline,
          implicitMoves,
          tip: reading.tip,
          aheadFloor,
          line: reported.current,
        })
        aheadFloor = frame?.aheadEnd
      } else
        frame = stepFrame(
          index,
          timeline,
          stepForLine(timeline, reported.current),
          implicitMoves
        )
      if (!sameFrame(frame, frames.get())) frames.set(frame)
      if (stamp - steppedAt >= STEP_INTERVAL_MS) {
        steppedAt = stamp
        const next: Shown = {
          by: liveJob,
          step: frame?.step ?? stepForLine(timeline, reported.current),
          line: frame?.line ?? reported.current,
          tool: toolShown(frame),
          eta: frame ? remainingEta(index, frame, followed) : null,
        }
        if (!sameShown(last, next)) {
          last = next
          setShown(next)
        }
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [liveJob, index, timeline, implicitMoves, frames, clock])

  /** The frame playback shows at `time`. */
  const playedFrame = (plan: PlanIndex, time: number) =>
    frameAt(plan, time, {
      source: "playback",
      status: "simulated",
      timeline,
      implicitMoves,
    })
  const playedShown = (frame: PlaybackFrame | null): Shown => ({
    by: PLAYBACK,
    step: frame?.step ?? 0,
    line: frame?.line ?? 0,
    tool: toolShown(frame),
    eta: null,
  })

  useEffect(() => {
    if (!playing || !index) return
    // A paused simulation goes on from where it stood.
    clock.pause()
    let steppedAt = -Infinity
    let request = 0
    const tick = (stamp: number) => {
      const time = clock.play(index, performance.timeOrigin + stamp, speed)
      // At the end the whole program shows again.
      if (time === null) {
        frames.set(null)
        setPlayback((current) =>
          current.program === program
            ? { ...current, position: count, simulating: false, playing: false }
            : current
        )
        return
      }
      const frame = playedFrame(index, time)
      frames.set(frame)
      if (stamp - steppedAt >= STEP_INTERVAL_MS) {
        steppedAt = stamp
        const next = playedShown(frame)
        setShown((current) => (sameShown(current, next) ? current : next))
      }
      request = requestAnimationFrame(tick)
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, program, index, timeline, implicitMoves, count, speed])

  // What the cursor shows: playback's or the follow's, a few times a second, else the step's.
  const current =
    shown && shown.by === (liveJob ?? (simulating ? PLAYBACK : null))
      ? shown
      : null
  let cursor = scrubbed
  // The whole program on show has no line of its own until the user moves the cursor.
  let line =
    positioned && scrubbed > 0
      ? (staticFrame?.line ?? timeline.steps[scrubbed - 1].line)
      : 0
  let tool = toolShown(staticFrame)
  // A step that shows every move made has the tool of the last in the spindle.
  if (!moving && !staticFrame && line > 0 && index?.plan.count)
    tool = { number: toolOf(index.plan, index.plan.count - 1, implicitMoves) }
  let eta = index && planEta(index)
  if (following) {
    cursor =
      current?.step ?? staticFrame?.step ?? stepForLine(timeline, target.line)
    // The reported line stays on the last feed move while the machine's rapids and routines run.
    line = Math.max(target.line, current?.line ?? staticFrame?.line ?? 0)
    tool = current ? current.tool : toolShown(staticFrame)
    eta = live ? (current?.eta ?? null) : null
  } else if (current) {
    cursor = current.step
    line = current.line
    tool = current.tool
  }

  const update = (patch: Partial<Omit<Playback, "program">>) =>
    setPlayback((value) => ({
      ...(value.program === program ? value : initialPlayback(program)),
      ...patch,
    }))
  const seek = (step: number) =>
    update({
      position: clampStep(step, count),
      simulating: false,
      playing: false,
      detachedFrom: target?.jobId ?? null,
    })

  return {
    timeline,
    cursor,
    line,
    tool,
    eta,
    frames,
    playing,
    speed,
    target,
    following,
    live,
    seek,
    seekLine: (programLine) => seek(stepForLine(timeline, programLine)),
    togglePlay: () => {
      if (playing) {
        const time = clock.time
        const frame = index && time !== null ? playedFrame(index, time) : null
        setShown(playedShown(frame))
        update({ playing: false, ...(frame ? { position: frame.step } : {}) })
        return
      }
      if (!index || !count) return
      // A paused simulation resumes; otherwise it starts after the moves on show, as the 3D
      // view shows them made for the step (a grid's sample, on its line), or over.
      let start: number | null = simulating ? clock.time : null
      start ??=
        cursor > 0 && cursor < count ? stepTime(index, timeline, cursor) : 0
      clock.set(start)
      const frame = playedFrame(index, start)
      frames.set(frame)
      setShown(playedShown(frame))
      update({
        position: frame?.step ?? 0,
        simulating: true,
        playing: true,
        detachedFrom: target?.jobId ?? null,
      })
    },
    setSpeed,
    follow: () =>
      update({ playing: false, simulating: false, detachedFrom: null }),
  }
}
