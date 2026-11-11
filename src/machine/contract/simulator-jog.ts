import { z } from "zod"

export const DIRECT_INPUT_TTL_MS = 150
export const DIRECT_SAMPLE_MS = 50
// Cross-process wall clocks can straddle a millisecond. Clamp small skew; never add it to TTL.
export const DIRECT_CLOCK_SKEW_MS = 5
export const SimulatedJogSessionSchema = z.strictObject({
  connectionId: z.string().uuid(),
  sessionId: z.string().uuid(),
})
export const BeginSimulatedJogRequestSchema = z.strictObject({
  connectionId: z.string().uuid(),
  mode: z.enum(["step", "direct"]),
})
export const SimulatedJogSampleSchema = SimulatedJogSessionSchema.extend({
  sequence: z.int().positive().safe(),
  capturedAt: z.int().nonnegative().safe(),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
  suppress: z.boolean(),
  spindleModifier: z.boolean(),
  neutral: z.boolean(),
  enableHeld: z.boolean(),
  speedScale: z.number().min(0.05).max(1),
}).refine(
  (sample) => Math.hypot(sample.x, sample.y, sample.z) <= 1.000001,
  "XYZ vector exceeds full deflection"
)
export const SimulatedJogActionSchema = SimulatedJogSessionSchema.extend({
  sequence: z.int().positive().safe(),
  capturedAt: z.int().nonnegative().safe(),
  action: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("step"),
      axis: z.enum(["X", "Y", "Z"]),
      distance: z
        .number()
        .min(-10)
        .max(10)
        .refine((n) => Math.abs(n) >= 0.1),
      speedScale: z.number().min(0.05).max(1),
    }),
    z.strictObject({ kind: z.literal("target"), rpm: z.int().positive() }),
    z.strictObject({ kind: z.literal("start"), rpm: z.int().positive() }),
    z.strictObject({ kind: z.literal("stop") }),
  ]),
})
export const SimulatedJogReceiptSchema = z.strictObject({
  sessionId: z.string().uuid(),
  sequence: z.int().nonnegative().safe(),
  kind: z.enum(["begin", "sample", "action", "end"]),
})
export type BeginSimulatedJogRequest = z.infer<
  typeof BeginSimulatedJogRequestSchema
>
export type SimulatedJogSession = z.infer<typeof SimulatedJogSessionSchema>
export type SimulatedJogSample = z.infer<typeof SimulatedJogSampleSchema>
export type SimulatedJogReceipt = z.infer<typeof SimulatedJogReceiptSchema>
export type SimulatedJogAction = z.infer<typeof SimulatedJogActionSchema>
