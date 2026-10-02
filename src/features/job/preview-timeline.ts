import { readNcBlock } from "@/machine/contract"
import type { NcBlock } from "@/machine/contract"
import type { CompiledPlate } from "@/domain/compile/compile"
import type { GCodeProgram, GCodeSegment } from "@/domain/nc/gcode"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { Operation } from "@/domain/operations/operation"
import { getProbingPreview } from "@/domain/probing/preview"
import { positionLabel } from "./job-view"

export type PreviewStep = {
  line: number
  probePoint?: number
}
export type PreviewTick = {
  step: number
  line: number
  kind:
    | "tool-change"
    | "pause"
    | "probe"
    | "touch-off"
    | "scan"
    | "spindle"
    | "end"
    | "operation"
    | "message"
  label: string
}
export type PreviewTimeline = {
  steps: PreviewStep[]
  ticks: PreviewTick[]
  probePoints: number
}

/** What a timeline is built from: a compiled plate's program, its sections and pause points. */
export type TimelineSource = Pick<
  CompiledPlate,
  "program" | "sections" | "pausePoints"
>

/** A tick before its step is known: what starts at a line. */
type Mark = Pick<PreviewTick, "kind" | "label">

/** The pause compiling writes before an operation that pauses before it: an M0. */
const STOP_BEFORE: Mark = { kind: "pause", label: "Pause (M0)" }

/**
 * The timelines of compiled programs, with the sections, operations and probing each was built
 * from. A plate whose operations did not change keeps its program object and its sections.
 */
const timelines = new WeakMap<
  GCodeProgram,
  {
    readonly sections: TimelineSource["sections"]
    readonly operations: readonly Operation[]
    readonly probing: FixtureKit["probing"]
    readonly timeline: PreviewTimeline
  }
>()

/**
 * Ordered source playback, not an estimate of controller cycle time. Its ticks mark where the
 * compiled plate's sections start, named with their operation as the job's position is
 * (`positionLabel`), its pause points, the grids the probe of the plate's machine measures,
 * spindle changes and the program's end. Cached per compiled program.
 */
export function buildPreviewTimeline(
  compiled: TimelineSource,
  operations: readonly Operation[],
  kit: Pick<FixtureKit, "probing">
): PreviewTimeline {
  const { program, sections } = compiled
  const cached = timelines.get(program)
  if (
    cached?.sections === sections &&
    cached.operations === operations &&
    cached.probing === kit.probing
  )
    return cached.timeline
  const timeline = timelineOf(compiled, operations, kit.probing)
  timelines.set(program, {
    sections,
    operations,
    probing: kit.probing,
    timeline,
  })
  return timeline
}

function timelineOf(
  { program, sections, pausePoints }: TimelineSource,
  operations: readonly Operation[],
  machine: FixtureKit["probing"]
): PreviewTimeline {
  const byId = new Map(operations.map((operation) => [operation.id, operation]))
  const probing = getProbingPreview(program, machine)
  const grids = new Map(probing.grids.map((grid) => [grid.sourceLine, grid]))
  const blocks = program.lines.map(readNcBlock)
  const executable = (block: NcBlock) =>
    !block.problem &&
    block.words.some(({ letter }) => letter !== "N" && letter !== "O")
  const marks = new Map<number, Mark[]>()
  const mark = (line: number, item: Mark) =>
    marks.set(line, [...(marks.get(line) ?? []), item])
  for (const section of sections) {
    // The program's end is marked where playback stops, after the operations' sections.
    if (
      section.kind === "metadata" ||
      section.kind === "setup" ||
      section.kind === "end"
    )
      continue
    // CAM operation headings may be comments. Attach their tick to the first
    // actual block, while retaining every event on compound M6/motion/M0 lines.
    let index = section.startLine - 1
    while (index < section.endLine && !executable(blocks[index])) index++
    if (index >= section.endLine) continue
    const operation = byId.get(section.operationId) ?? null
    mark(index + 1, {
      kind: section.kind === "toolpath" ? "operation" : section.kind,
      label: positionLabel(operation, section) ?? section.name,
    })
  }
  // The NC's own pauses are sections; those compiling adds before operations are not.
  for (const point of pausePoints)
    if (point.reason === "stop-before") mark(point.line, STOP_BEFORE)
  const steps: PreviewStep[] = []
  const ticks: PreviewTick[] = []
  for (let index = 0; index < program.lines.length; index++) {
    const line = index + 1
    const block = blocks[index]
    if (!executable(block)) continue
    const step = steps.length + 1
    const grid = grids.get(line)
    if (grid) {
      for (let point = 0; point < grid.samples.length; point++)
        steps.push({ line, probePoint: point })
      ticks.push({
        step,
        line,
        kind: "probe",
        label: `Probe grid · ${grid.samples.length} points`,
      })
    } else steps.push({ line })
    for (const item of marks.get(line) ?? [])
      if (item.kind !== "probe" || !grid) ticks.push({ step, line, ...item })
    if (block.message !== null) continue
    const ends = block.words.some(
      (word) => word.letter === "M" && [2, 30].includes(word.value)
    )
    if (ends) ticks.push({ step, line, kind: "end", label: "Program end" })
    const spindleCommands = block.words.filter(
      (word) => word.letter === "M" && [3, 4, 5].includes(word.value)
    )
    for (const spindle of spindleCommands)
      ticks.push({
        step,
        line,
        kind: "spindle",
        label:
          spindle.value === 5
            ? "Spindle off"
            : `Spindle on (M${spindle.value})`,
      })
    if (ends) break
  }
  return { steps, ticks, probePoints: probing.pointCount }
}

export function stepForLine(
  timeline: Pick<PreviewTimeline, "steps">,
  line: number
) {
  if (line <= 0 || Number.isNaN(line)) return 0
  let low = 0,
    high = timeline.steps.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (timeline.steps[middle].line < line) low = middle + 1
    else high = middle
  }
  return Math.min(low + 1, timeline.steps.length)
}

/** The step that shows a move: its line's, or on a probe grid's line, its sample's. */
export function stepForMove(
  timeline: Pick<PreviewTimeline, "steps">,
  { line, probePoint = 0 }: Pick<GCodeSegment, "line" | "probePoint">
) {
  let step = stepForLine(timeline, line)
  // A grid's line has a step for each sample, in the order they are probed.
  while (
    step < timeline.steps.length &&
    timeline.steps[step].line === line &&
    (timeline.steps[step].probePoint ?? 0) <= probePoint
  )
    step++
  return step
}
