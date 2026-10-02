import { z } from "zod"

/** One of the machine's home switches as it reads: the axis it homes, the end it sits at. */
export const HomeSwitchSchema = z.object({
  axis: z.enum(["X", "Y", "Z", "A", "B", "C"]),
  end: z.enum(["min", "max"]),
  closed: z.boolean(),
})
export type HomeSwitch = z.infer<typeof HomeSwitchSchema>

/** The machine's switches as one read found them. */
export const SwitchReportSchema = z.object({
  homes: z.array(HomeSwitchSchema).max(6),
  /** Whether the probe input reads triggered; null where the machine does not say. */
  probe: z.boolean().nullable(),
  /** When it was read, in milliseconds since the epoch. */
  at: z.number(),
})
export type SwitchReport = z.infer<typeof SwitchReportSchema>
