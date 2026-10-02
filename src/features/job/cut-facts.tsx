import { useWorkspace } from "@/app/workspace/workspace-context"
import { lineCut } from "@/domain/tools/cut-engagement"
import type { LineCut, LineCutKind } from "@/domain/tools/cut-engagement"
import type { Tool } from "@/domain/tools/tool"
import { HeightMapFacts } from "@/components/workspace/height-map-grid"
import type { JobSubject } from "./job-view"
import type { CutPrediction } from "./use-cut-prediction"
import type { CursorTool } from "./use-job-timeline"

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
 * view draws at the timeline's cursor.
 */
function toolText(
  subject: JobSubject,
  tools: readonly Tool[],
  tool: CursorTool | null
): string {
  if (!tool) return "—"
  const { number } = tool
  const toolId = subject.plate.tools.find(
    (entry) => entry.number === number
  )?.toolId
  const name = tools.find((item) => item.id === toolId)?.name
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
  tool: shown,
}: {
  subject: JobSubject | null
  prediction: CutPrediction | null
  /** The line on show; 0 while the whole program shows. */
  line: number
  /** The tool in the spindle at the timeline's cursor; null while none shows. */
  tool: CursorTool | null
}) {
  const library = useWorkspace((state) => state.tools)
  const tools = subject?.tools ?? library
  const values = cutValues(prediction, line)
  const tool = subject ? toolText(subject, tools, shown) : "—"
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
