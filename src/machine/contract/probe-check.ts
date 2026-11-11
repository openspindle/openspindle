import { z } from "zod"

export const ProbeCheckBindingSchema = z.strictObject({
  id: z.uuid(),
  position: z.tuple([
    z.number().finite().min(-10000).max(10000),
    z.number().finite().min(-10000).max(10000),
    z.number().finite().min(-10000).max(10000),
  ]),
  tool: z.number().int().nonnegative(),
  toolOffset: z.number().finite().min(-10000).max(10000),
})
export type ProbeCheckBinding = z.infer<typeof ProbeCheckBindingSchema>

export const ProbeCheckSchema = z.object({
  phase: z.enum(["released", "triggered", "verified"]),
  binding: ProbeCheckBindingSchema,
  connectionId: z.uuid(),
  startedAt: z.number(),
  expiresAt: z.number(),
})
export type ProbeCheck = z.infer<typeof ProbeCheckSchema>
