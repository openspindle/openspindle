import { z } from "zod"

/** Serializable mathematical engraving recipe, independent of the renderer or WASM runtime. */
export const PatternParameterSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/),
  value: z.number().finite(),
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().positive().finite(),
})
const FormulaSchema = z
  .object({
    x: z.string().min(1).max(500),
    y: z.string().min(1).max(500),
    z: z.string().min(1).max(500),
    tMin: z.number().finite(),
    tMax: z.number().finite(),
    samples: z.number().int().min(2).max(2400),
    paths: z.number().int().min(1).max(240),
    parameters: z.array(PatternParameterSchema).max(32),
    safeZ: z.number().min(0.5).max(100),
    feed: z.number().min(1).max(10000),
    plunge: z.number().min(1).max(10000),
    rpm: z.number().int().min(1000).max(40000),
    tool: z.number().int().min(1).max(999),
  })
  .superRefine((p, ctx) => {
    if (p.samples * p.paths > 90000)
      ctx.addIssue({
        code: "custom",
        message: "Too many toolpath points.",
        path: ["samples"],
      })
    if (p.tMin >= p.tMax || p.tMax - p.tMin > 1000)
      ctx.addIssue({
        code: "custom",
        message: "Invalid interval.",
        path: ["tMax"],
      })
    const names = new Set<string>()
    for (const [i, param] of p.parameters.entries()) {
      if (
        names.has(param.name) ||
        ["t", "i", "n", "pi", "tau"].includes(param.name) ||
        param.value < param.min ||
        param.value > param.max
      )
        ctx.addIssue({
          code: "custom",
          message: "Invalid slider value or duplicate name.",
          path: ["parameters", i],
        })
      names.add(param.name)
    }
  })
const LayerStyle = {
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
}
export const PATTERN_FONTS = ["serif", "sans-serif", "monospace"] as const
export const PatternLayerSchema = z.discriminatedUnion("kind", [
  z.object({
    ...LayerStyle,
    kind: z.literal("formula"),
    formula: FormulaSchema,
  }),
  z.object({
    ...LayerStyle,
    kind: z.literal("circle-mask"),
    x: z.number().min(-200).max(200),
    y: z.number().min(-200).max(200),
    radius: z.number().min(0.1).max(100),
  }),
  z.object({
    ...LayerStyle,
    kind: z.literal("dial-mask"),
    font: z.enum(PATTERN_FONTS),
    radius: z.number().min(1).max(100),
    size: z.number().min(0.5).max(12),
  }),
  z.object({
    ...LayerStyle,
    kind: z.literal("cutout"),
    radius: z.number().min(1).max(150),
    diameter: z.number().min(0.1).max(20),
    thickness: z.number().min(0.1).max(30),
    breakthrough: z.number().min(0).max(0.5),
    stepDown: z.number().min(0.05).max(3),
    tool: z.number().int().min(1).max(999),
    feed: z.number().min(1).max(10000),
    plunge: z.number().min(1).max(10000),
    rpm: z.number().int().min(1000).max(40000),
  }),
])

export const PatternSpecSchema = FormulaSchema.safeExtend({
  color: LayerStyle.color.optional(),
  maskClearance: z.number().min(0).max(20).optional(),
  layers: z.array(PatternLayerSchema).max(12).optional(),
})
export type PatternLayer = z.infer<typeof PatternLayerSchema>
export type PatternSpec = z.infer<typeof PatternSpecSchema>
