import { z } from "zod"

/** The speeds the app's simulator moves at: how many times faster than a Z1. */
export const SIMULATOR_SPEEDS = [1, 2, 5, 10, 20] as const

export const SimulatorSettingsSchema = z.strictObject({
  /** Whether the app runs its simulated Z1 (Settings › General › Z1 Simulator device). */
  enabled: z.boolean(),
  speed: z.literal(SIMULATOR_SPEEDS),
})
export type SimulatorSettings = z.infer<typeof SimulatorSettingsSchema>

export const DEFAULT_SIMULATOR_SETTINGS: SimulatorSettings = {
  enabled: true,
  speed: 1,
}

/** The app's simulator: its settings, where it listens and whether it does. */
export const SimulatorStatusSchema = z.strictObject({
  settings: SimulatorSettingsSchema,
  host: z.string(),
  port: z.number().int().min(1).max(65_535),
  running: z.boolean(),
  /** Why it is not running although enabled, such as its port being taken. */
  error: z.string().nullable(),
})
export type SimulatorStatus = z.infer<typeof SimulatorStatusSchema>

/** The simulated Z1 the desktop main process runs. */
export const simulatorMethods = {
  "simulator.status": {
    params: z.undefined(),
    result: SimulatorStatusSchema,
    timeoutMs: 10_000,
  },
  /** Starts or stops it, and changes its speed at once; the change is kept. */
  "simulator.update": {
    params: SimulatorSettingsSchema.partial(),
    result: SimulatorStatusSchema,
    timeoutMs: 10_000,
  },
}
