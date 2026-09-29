import { useEffect, useState } from "react"
import { machineProgram } from "@/app/workspace/machine-program"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { revealedSegments } from "@/components/workspace/viewer/toolpath-buffers"
import { moveTimes, playheadAt, timeAfterMoves } from "@/domain/nc/move-times"
import type { Playhead } from "@/domain/nc/move-times"
import {
  buildPreviewTimeline,
  previewAt,
  stepForLine,
  stepForMove,
} from "./preview-timeline"
import type { PreviewTimeline } from "./preview-timeline"
import type { FollowTarget, JobSubject } from "./job-view"

const EMPTY_TIMELINE: PreviewTimeline = { steps: [], ticks: [], probePoints: 0 }

type Playback = {
  /** The program the position belongs to; another program starts over, fully shown. */
  readonly program: GCodeProgram | null
  /** Fractional timeline step; null shows the whole program. */
  readonly position: number | null
  /**
   * Seconds into the machine's moves while playback simulates them, at their feeds; null while
   * the cursor is on a step.
   */
  readonly time: number | null
  readonly playing: boolean
  /** The job the user scrubbed away from; any other job is followed again. */
  readonly detachedFrom: string | null
}

const initialPlayback = (program: GCodeProgram | null): Playback => ({
  program,
  position: null,
  time: null,
  playing: false,
  detachedFrom: null,
})

const clampStep = (step: number, count: number) =>
  Math.max(0, Math.min(count, Number.isNaN(step) ? 0 : step))

/**
 * What the 3D viewer draws at the cursor: the program up to a line, or, while playback simulates
 * it, up to the tool along the move under way (`playhead`, in the machine's moves).
 */
export type TimelinePreview = ReturnType<typeof previewAt> & {
  readonly playhead: Playhead | null
}

export type JobTimeline = {
  readonly timeline: PreviewTimeline
  /** Timeline step on show. */
  readonly cursor: number
  /** The program line on show: the machine's own line while following, 0 for none. */
  readonly line: number
  readonly preview: TimelinePreview
  readonly playing: boolean
  readonly speed: number
  /** This window's job position, while it has one. */
  readonly target: FollowTarget | null
  /** The cursor follows the target; false once the user scrubs away from it. */
  readonly following: boolean
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
 * playback speed; while this window's job reports progress it follows the machine's line until
 * the user scrubs.
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
  const playback =
    stored.program === program ? stored : initialPlayback(program)
  const following = target !== null && playback.detachedFrom !== target.jobId
  // Following the machine ends preview playback, so it cannot resume on its own afterwards.
  if (following && stored.playing) setPlayback({ ...stored, playing: false })
  const playhead =
    !following && playback.time !== null && timed
      ? playheadAt(timed, playback.time)
      : null
  const moving = playhead && machine?.segments.at(playhead.segment)
  let cursor = Math.floor(clampStep(playback.position ?? count, count))
  if (following) cursor = stepForLine(timeline, target.line)
  else if (moving) cursor = stepForMove(timeline, moving)
  let preview: TimelinePreview = {
    ...(program
      ? previewAt(timeline, cursor, program)
      : { line: 0, probePoint: undefined, segmentProgress: 0 }),
    playhead: null,
  }
  if (moving && machine)
    preview = {
      line: moving.line,
      probePoint: moving.probePoint,
      segmentProgress: (100 * playhead.segment) / machine.segments.length,
      playhead,
    }
  const playing = playback.playing && !following
  // The whole program on show has no line of its own until the user moves the cursor.
  let line = preview.line
  if (following) line = target.line
  else if (playback.position === null && playback.time === null) line = 0

  const update = (patch: Partial<Omit<Playback, "program">>) =>
    setPlayback((current) => ({
      ...(current.program === program ? current : initialPlayback(program)),
      ...patch,
    }))
  const seek = (step: number) =>
    update({
      position: clampStep(step, count),
      time: null,
      playing: false,
      detachedFrom: target?.jobId ?? null,
    })

  useEffect(() => {
    if (!playing || !timed) return
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const elapsed = ((now - last) / 1000) * speed
      last = now
      setPlayback((current) => {
        if (current.program !== program || !current.playing) return current
        const time = (current.time ?? 0) + elapsed
        // At the end the whole program shows again.
        if (time >= timed.duration)
          return { ...current, time: null, position: count, playing: false }
        return { ...current, time }
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, program, timed, count, speed])

  return {
    timeline,
    cursor,
    line,
    preview,
    playing,
    speed,
    target,
    following,
    seek,
    seekLine: (programLine) => seek(stepForLine(timeline, programLine)),
    togglePlay: () => {
      if (playing) {
        update({ playing: false })
        return
      }
      if (!timed || !machine || !count) return
      // A paused simulation resumes; otherwise it starts after the moves on show, as the 3D
      // view reveals them for the step (a grid's sample, on its line), or over.
      const paused =
        !following && playback.time !== null && playback.time < timed.duration
      const step =
        cursor > 0 && cursor < count ? timeline.steps[cursor - 1] : null
      const shown = step
        ? revealedSegments(machine, 100, step.line, step.probePoint)
        : 0
      update({
        time: paused ? playback.time : timeAfterMoves(timed, shown),
        playing: true,
        detachedFrom: target?.jobId ?? null,
      })
    },
    setSpeed,
    follow: () => update({ playing: false, time: null, detachedFrom: null }),
  }
}
