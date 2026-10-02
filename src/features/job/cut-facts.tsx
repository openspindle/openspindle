import { useMemo, useSyncExternalStore } from "react"
import { toViewerPlate } from "@/features/viewer/viewer-plate"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { revealedSegments } from "@/components/workspace/viewer/toolpath-buffers"
import {
  moveTools,
  toolOfMove,
} from "@/components/workspace/viewer/toolpath-view"
import type { MoveTools } from "@/components/workspace/viewer/toolpath-view"
import type { PlayheadSource } from "@/components/workspace/viewer/viewer-input"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { lineCut } from "@/domain/tools/cut-engagement"
import type { LineCut, LineCutKind } from "@/domain/tools/cut-engagement"
import type { Tool } from "@/domain/tools/tool"
import { HeightMapFacts } from "@/components/workspace/height-map-grid"
import type { JobSubject } from "./job-view"
import type { CutPrediction } from "./use-cut-prediction"

const millimetres = (value: number) => `${value.toFixed(3)} mm`

/** The depth of cut of a line that removes nothing, by what it does instead. */
const NOT_CUTTING: Record<Exclude<LineCutKind, "cut">, string> = {
  none: "—",
  rapid: "Rapid move",
  probe: "Probing",
  air: "Not cutting",
  unknown: "Tool shape unknown",
}

/**
 * "T2 · name" for the tool in the spindle, as the plate's tool table names it: the tool the 3D
 * view draws, the one making the move the playhead is on, else the last move of the machine
 * program up to `line`.
 */
function toolText(
  subject: JobSubject,
  tools: readonly Tool[],
  program: GCodeProgram,
  moves: MoveTools,
  line: number,
  move: number | null
): string {
  if (move === null && (line <= 0 || !program.segments.length)) return "—"
  const number = toolOfMove(
    program,
    moves,
    move ?? Math.max(0, revealedSegments(program, 100, line) - 1)
  )
  const toolId = subject.plate.tools.find(
    (entry) => entry.number === number
  )?.toolId
  const name = tools.find((tool) => tool.id === toolId)?.name
  return (
    [number === null ? null : `T${number}`, name]
      .filter((part) => !!part)
      .join(" · ") || "—"
  )
}

/** The facts' values for a line, or what stands in for them before they are known. */
function cutValues(prediction: CutPrediction | null, line: number) {
  if (!prediction || line <= 0) return { depth: "—", width: "—", below: "—" }
  if (prediction.status === "calculating")
    return { depth: "Calculating…", width: "Calculating…", below: "—" }
  if (prediction.status === "failed")
    return { depth: "Unavailable", width: "Unavailable", below: "—" }
  const cut: LineCut = lineCut(prediction.engagement, line)
  return {
    depth: cut.kind === "cut" ? millimetres(cut.depth) : NOT_CUTTING[cut.kind],
    width: cut.kind === "cut" ? millimetres(cut.width) : "—",
    below:
      cut.belowTop !== null && cut.belowTop > 0.0005
        ? millimetres(cut.belowTop)
        : "—",
  }
}

/**
 * The cut at the timeline's line: the tool in the spindle, the depth and width of cut the
 * sweep of the stock predicts for the line's moves, and how far below the stock top they
 * leave the tool's tip.
 */
export function CutFacts({
  subject,
  prediction,
  line,
  playhead,
}: {
  subject: JobSubject | null
  prediction: CutPrediction | null
  /** The line on show; 0 while the whole program shows. */
  line: number
  /** Where playback or a followed job is along the moves; a change of move re-renders. */
  playhead: PlayheadSource
}) {
  const move = useSyncExternalStore(
    playhead.subscribe,
    () => playhead.get()?.segment ?? null
  )
  const library = useWorkspace((state) => state.tools)
  const tools = subject?.tools ?? library
  const plate = subject
    ? toViewerPlate(subject.plate, subject.compiled, tools)
    : null
  // Both come from the cached viewer plate, which keeps them while its plate stays.
  const program = plate?.machineProgram ?? null
  const runs = plate?.tools ?? null
  const moves = useMemo(
    () => (program && runs ? moveTools(program, runs) : null),
    [program, runs]
  )
  const values = cutValues(prediction, line)
  const tool =
    subject && program && moves
      ? toolText(subject, tools, program, moves, line, move)
      : "—"
  return (
    <HeightMapFacts
      facts={[
        {
          label: "Tool",
          value: (
            <span className="block truncate" title={tool}>
              {tool}
            </span>
          ),
        },
        { label: "Depth of cut", value: values.depth },
        { label: "Width of cut", value: values.width },
        { label: "Below stock top", value: values.below },
      ]}
    />
  )
}
