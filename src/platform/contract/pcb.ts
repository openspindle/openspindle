import { z } from "zod"
import { LIMITS } from "../../domain/pcb/manifest.mjs"

export const PcbStatusSchema = z.strictObject({
  /** The chosen program, or null to find the installed pcb2gcode automatically. */
  executable: z.string().max(4096).nullable(),
  status: z.enum(["ready", "needs-setup", "degraded"]),
  message: z.string().max(2000),
})
export type PcbStatus = z.infer<typeof PcbStatusSchema>

export const PcbGenerationRequestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  files: z
    .array(
      z.strictObject({
        role: z.enum(["front", "back", "outline", "drill"]),
        name: z.string().min(1).max(180),
        content: z.string().min(1).max(LIMITS.inputFile),
      })
    )
    .min(1)
    .max(16),
  parameters: z.record(
    z.string(),
    z.union([z.number(), z.string(), z.boolean()])
  ),
})
export type PcbGenerationRequest = z.infer<typeof PcbGenerationRequestSchema>

export const PcbGenerationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  programs: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(200),
        source: z.string().min(1).max(LIMITS.outputFile),
      })
    )
    .max(LIMITS.outputCount),
  warnings: z.array(z.string()),
})
export type PcbGeneration = z.infer<typeof PcbGenerationSchema>

export const pcbMethods = {
  "pcb.status": {
    params: z.undefined(),
    result: PcbStatusSchema,
    timeoutMs: 30_000,
  },
  "pcb.chooseExecutable": {
    params: z.undefined(),
    result: PcbStatusSchema,
    timeoutMs: 0,
  },
  "pcb.setExecutable": {
    params: z.strictObject({ executable: z.string().max(4096).nullable() }),
    result: PcbStatusSchema,
    timeoutMs: 30_000,
  },
  "pcb.generate": {
    params: PcbGenerationRequestSchema,
    result: PcbGenerationSchema,
    timeoutMs: 0,
    budget: "pcb",
  },
} as const
