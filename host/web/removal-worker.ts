import { parseGCode } from "@/domain/nc/gcode"
import { programTools } from "@/domain/nc/tool-comments"
import { readNcBlock } from "@/machine/contract"
import { MaterialRemoval } from "@/domain/tools/material-removal"
import type { RemovalCutter } from "@/domain/tools/removal-cutter"
import type { FreecadHandoff } from "@/formats/freecad/handoff"

let model: MaterialRemoval | null = null
let lines: number[] = []
self.onmessage = (
  event: MessageEvent<{ bundle?: FreecadHandoff; line: number }>
) => {
  try {
    if (event.data.bundle) {
      const bundle = event.data.bundle,
        source = bundle.program.nc,
        program = parseGCode(source)
      if (program.unreadable || program.segments.length > 50000)
        throw new Error(
          "Removal requires a supported plain three-axis program with at most 50,000 segments."
        )
      for (const line of source.split(/\r?\n/)) {
        const block = readNcBlock(line)
        if (
          block.problem ||
          block.words.some(
            (w) =>
              ["A", "B", "C"].includes(w.letter) ||
              (w.letter === "G" &&
                [
                  10, 18, 19, 32, 38.2, 38.3, 41, 42, 50, 51, 52, 55, 56, 57,
                  58, 59, 68, 69, 81, 82, 83, 92,
                ].includes(w.value))
          )
        )
          throw new Error(
            "Removal does not support this program's probing, cycles, coordinate changes or rotary moves."
          )
      }
      const tools = programTools(source, null)
      const segments = program.segments.map((segment) => {
        let cutter: RemovalCutter | null = null
        if (
          !segment.rapid &&
          !segment.probing &&
          !segment.routine &&
          !segment.toolSetterTouch &&
          Math.min(segment.start[2], segment.end[2]) < bundle.stock.max[2]
        ) {
          const tool = tools.get(segment.tool)
          if (
            !tool?.diameter ||
            !tool.fluteLength ||
            segment.spindle <= 0 ||
            bundle.stock.max[2] - Math.min(segment.start[2], segment.end[2]) >
              tool.fluteLength
          )
            throw new Error(
              "Removal needs known cutter geometry, cutting length and a running spindle."
            )
          if (tool.kind === "flat end mill" || tool.kind === "face mill")
            cutter = { kind: "flat", radius: tool.diameter / 2 }
          else if (
            tool.freecad?.includedAngle &&
            tool.freecad.tipDiameter !== null
          )
            cutter = {
              kind: "v-bit",
              radius: tool.diameter / 2,
              tipRadius: tool.freecad.tipDiameter / 2,
              slope: 1 / Math.tan((tool.freecad.includedAngle * Math.PI) / 360),
            }
          else
            throw new Error("This cutter profile is not supported for removal.")
        }
        return { start: segment.start, end: segment.end, cutter }
      })
      lines = program.segments.map((s) => s.line)
      model = new MaterialRemoval({
        min: bundle.stock.min,
        max: bundle.stock.max,
        segments,
        resolution: 512,
      })
    }
    if (!model) throw new Error("No sampled stock available.")
    let move = lines.findIndex((line) => line > event.data.line)
    if (move < 0) move = lines.length
    const grid = model.at({ move, fraction: 0 })
    self.postMessage({ grid }, { transfer: [grid.heights.buffer] })
  } catch (error) {
    model = null
    self.postMessage({
      error: error instanceof Error ? error.message : "Removal unavailable.",
    })
  }
}
