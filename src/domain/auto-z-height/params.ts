import { z } from "zod"
import { COORDINATE_LIMIT } from "../primitives"
import type { ParameterSpec } from "../probing/parameters"
import { ProbePlacementSchema } from "../probing/placement"

/** The touch-off parameters that a machine's probe gives ranges and defaults. */
export type AutoZHeightField = "probeTravel" | "clearance"

/** A machine's touch-off parameters, which its probe defines (`TouchOff.parameters`). */
export type AutoZHeightParameters = Readonly<
  Record<AutoZHeightField, ParameterSpec>
>

const storedLength = z.number().positive().max(COORDINATE_LIMIT)

/**
 * A built-in auto Z-height operation, as stored for any machine. Its NC is derived from these
 * parameters at compile time, within the ranges of the machine's probe (`rangedSchema`).
 */
export const AutoZHeightParamsSchema = z.strictObject({
  /** Longest downward search of the touch, mm. */
  probeTravel: storedLength,
  /** Lift above the probed surface once work Z is set, mm. */
  clearance: storedLength,
  /** Where the probe touches: below the probe position, or at a stored anchor plus an offset. */
  placement: ProbePlacementSchema,
})

export type AutoZHeightParams = z.infer<typeof AutoZHeightParamsSchema>
