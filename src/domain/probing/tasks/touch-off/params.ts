import { z } from "zod"
import { COORDINATE_LIMIT } from "../../../primitives"
import type { SpecsOf } from "../../parameters"
import { ProbePlacementSchema } from "../../placement"

/** The touch-off parameters that a machine's probe gives ranges and defaults. */
export type TouchOffField = "probeTravel" | "clearance"

/** A machine's touch-off parameters, which its probe defines (`TouchOff.parameters`). */
export type TouchOffSpecs = SpecsOf<TouchOffParams, TouchOffField>

const storedLength = z.number().positive().max(COORDINATE_LIMIT)

/**
 * A built-in auto Z-height operation, as stored for any machine. Its NC is derived from these
 * parameters at compile time, within the ranges of the machine's probe (`rangedSchema`).
 */
export const TouchOffParamsSchema = z.strictObject({
  /** Longest downward search of the touch, mm. */
  probeTravel: storedLength,
  /** Lift above the probed surface once work Z is set, mm. */
  clearance: storedLength,
  /** Where the probe touches: below the probe position, or at a stored anchor plus an offset. */
  placement: ProbePlacementSchema,
})

export type TouchOffParams = z.infer<typeof TouchOffParamsSchema>
