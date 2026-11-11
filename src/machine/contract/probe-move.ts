import { z } from "zod"

export const ProbeMovePlanSchema = z.strictObject({
  mode: z.enum(["xy", "z"]),
  target: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  feed: z.tuple([
    z.number().positive().max(10000),
    z.number().positive().max(10000),
    z.number().positive().max(10000),
  ]),
})
export type ProbeMovePlan = z.infer<typeof ProbeMovePlanSchema>
