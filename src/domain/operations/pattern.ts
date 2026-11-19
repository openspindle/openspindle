import { z } from "zod"

/** Serializable mathematical engraving recipe, independent of the renderer or WASM runtime. */
export const PatternParameterSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/),
  value: z.number().finite(),
  min: z.number().finite(),
  max: z.number().finite(),
  step: z.number().positive().finite(),
})
export const PatternSpecSchema = z
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
export type PatternSpec = z.infer<typeof PatternSpecSchema>
