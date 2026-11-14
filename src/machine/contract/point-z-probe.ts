import { z } from "zod"
import { ProbeMovePlanSchema } from "./probe-move.ts"
import { ZProbeSettingsSchema } from "./z-probe.ts"

/** Reviewed XY positioning followed by a bounded surface search from the raised height. */
export const PointZProbePlanSchema = z.strictObject({
  target: z.tuple([z.number().finite(), z.number().finite()]),
  feed: ProbeMovePlanSchema.shape.feed,
  settings: ZProbeSettingsSchema,
})
export type PointZProbePlan = z.infer<typeof PointZProbePlanSchema>
