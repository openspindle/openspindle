import { useEffect, useRef, useState } from "react"
import { machineProgram } from "@/app/workspace/machine-program"
import type { PlayheadSource } from "@/components/workspace/bed-viewer"
import { revealedSegments } from "@/components/workspace/viewer/toolpath-buffers"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { GCodeProgram } from "@/domain/nc/gcode"
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

/**
 * How often, at most, the step on show follows simulated playback: the timeline, the G-code and
 * the cut facts, which render with the Job tab. The 3D view follows every frame on its own.
 */
const STEP_INTERVAL_MS = 100

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
  private playhead: Playhead | null = null
  private readonly listeners = new Set<() => void>()
  readonly get = () => this.playhead
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(playhead: Playhead | null) {
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
  /** Where simulated playback is along the machine's moves, which the 3D view follows. */
  readonly playhead: PlayheadSource
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
 * playback speed: the 3D view follows the moves every frame (`playhead`), while the step on show
 * follows a few times a second, so the tab does not render every frame. While this window's job
 * reports progress it follows the machine's line until the user scrubs.
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
  let cursor = Math.floor(clampStep(playback.position ?? count, count))
  if (following) cursor = stepForLine(timeline, target.line)
  const preview: TimelinePreview = program
    ? previewAt(timeline, cursor, program)
    : { line: 0, probePoint: undefined, segmentProgress: 0 }
  // The whole program on show has no line of its own until the user moves the cursor.
  let line = preview.line
  if (following) line = target.line
  else if (playback.position === null && !simulating) line = 0

  // A simulation that ended, or of another program, shows no playhead.
  useEffect(() => {
    if (simulating) return
    time.current = null
    playhead.set(null)
  }, [simulating, program, playhead])

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
