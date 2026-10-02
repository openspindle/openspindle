import type {
  ViewerPlate,
  ViewerToolRun,
} from "@/components/workspace/viewer/viewer-input"
import type { CompiledPlate } from "@/domain/compile/compile"
import type { GCodeProgram } from "@/domain/nc/gcode"
import { plateToolpathBounds } from "@/domain/compile/toolpath-bounds"
import type { Plate } from "@/domain/plate/plate"
import { toolShape } from "@/domain/tools/tool-shape"
import type { Tool } from "@/domain/tools/tool"
import { anchorDisplayName, bedAnchors } from "@/domain/anchors/stored-anchors"
import { machineProgram } from "@/app/workspace/machine-program"

/** How a run's tool is drawn: its 3D model, or else its shape. */
type ToolLook = Pick<ViewerToolRun, "shape" | "model">
const NO_TOOL: ToolLook = { shape: null, model: null }

const viewerPlates = new WeakMap<
  Plate,
  { viewerPlate: ViewerPlate; library: readonly Tool[] }
>()

/**
 * The tools in the spindle through the program: each section's active tool, looked up in the
 * plate's tool table and the library, from its change on, so a tool shows before its first
 * move and while the probe probes. Before a section's operation changes tools, its lines are
 * the implicit tool's (the table's entry without a number), or else the tool still in the
 * spindle's.
 */
function toolRuns(
  plate: Plate,
  compiled: CompiledPlate,
  library: readonly Tool[]
): ViewerToolRun[] {
  const looks = new Map<number | null, ToolLook>()
  for (const entry of plate.tools) {
    const tool = library.find((item) => item.id === entry.toolId)
    looks.set(
      entry.number,
      tool ? { shape: toolShape(tool), model: tool.model } : NO_TOOL
    )
  }
  const runs: ViewerToolRun[] = []
  for (const section of compiled.sections) {
    const { startLine, endLine, segmentStart, segmentEnd } = section
    const previous = runs.at(-1)
    const inherited = section.tool === null && !looks.has(null)
    const tool = inherited ? (previous?.tool ?? null) : section.tool
    const { shape, model } = inherited
      ? (previous ?? NO_TOOL)
      : (looks.get(section.tool) ?? NO_TOOL)
    // Each tool change starts a run, as a probing operation's does after another's.
    if (
      section.kind !== "tool-change" &&
      previous?.tool === tool &&
      previous.shape === shape &&
      previous.model === model &&
      previous.segmentEnd === segmentStart
    )
      runs[runs.length - 1] = { ...previous, lineEnd: endLine, segmentEnd }
    else
      runs.push({
        lineStart: startLine,
        lineEnd: endLine,
        segmentStart,
        segmentEnd,
        tool,
        shape,
        model,
      })
  }
  return runs
}

/**
 * What the 3D viewer draws for a plate: its compiled program at its single work origin, as its
 * machine moves through it (`machine`, such as a Run's plan from where the machine was, else the
 * plate's own placement), and the library's tools on its tool table. Cached per plate object, so
 * an unchanged plate keeps the same viewer plate.
 */
export function toViewerPlate(
  plate: Plate,
  compiled: CompiledPlate,
  library: readonly Tool[],
  machine: GCodeProgram | null = null
): ViewerPlate {
  const cached = viewerPlates.get(plate)
  const machineProgramOf = machine ?? machineProgram(plate, compiled.program)
  if (
    cached?.viewerPlate.program === compiled.program &&
    cached.viewerPlate.machineProgram === machineProgramOf &&
    cached.library === library
  )
    return cached.viewerPlate
  const anchors = plate.setup.anchors
  const toolpath = plateToolpathBounds(plate)
  const viewerPlate: ViewerPlate = {
    id: plate.id,
    name: plate.name,
    program: compiled.program,
    machineProgram: machineProgramOf,
    tools: toolRuns(plate, compiled, library),
    toolpathBounds: toolpath.ok ? toolpath.bounds : null,
    stock: plate.setup.stock,
    stockAnchor: plate.setup.stockAnchor,
    workOrigin: plate.setup.workOrigin,
    storedAnchors: bedAnchors(anchors ?? undefined).map((anchor) => ({
      ...anchor,
      name: anchorDisplayName(anchor, anchors?.source === "factory"),
    })),
    ...(anchors ? { anchorSetup: anchors } : {}),
    fixtures: plate.setup.fixtures,
    deviceId: plate.setup.deviceId,
  }
  viewerPlates.set(plate, { viewerPlate, library })
  return viewerPlate
}
