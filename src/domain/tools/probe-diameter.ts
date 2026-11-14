import { z } from "zod"
import { ToolSchema } from "./tool"
import type { Tool } from "./tool"

/** User-editable contact diameter; a saved calibration always takes precedence. */
export const DEFAULT_PROBE_TIP_DIAMETER = 2
export const ProbeTipDiameterSchema = z.number().finite().min(0.5).max(10)

/** Keep a tip dimension that described the same contact ball in sync. */
export function withProbeTipDiameter(tool: Tool, diameter: number): Tool {
  return ToolSchema.parse({
    ...tool,
    diameter: ProbeTipDiameterSchema.parse(diameter),
    geometry: {
      ...tool.geometry,
      tipDiameter:
        tool.geometry.tipDiameter === tool.diameter
          ? diameter
          : tool.geometry.tipDiameter,
    },
  })
}
