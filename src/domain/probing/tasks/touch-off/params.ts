import { z } from "zod"
import { COORDINATE_LIMIT } from "../../../primitives"
import type { SpecsOf } from "../../parameters"
import { ProbePlacementSchema } from "../../placement"

/** The touch-off parameters that a method gives ranges and defaults. */
export type TouchOffField = "probeTravel" | "clearance"

/** A method's touch-off parameters on a machine (`ProbingMethod.parameters`). */
export type TouchOffSpecs = SpecsOf<TouchOffParams, TouchOffField>

const storedLength = z.number().positive().max(COORDINATE_LIMIT)

/**
 * A touch-off's parameters, as stored for any machine. Its method writes the NC from them at
 * compile time, within the ranges it gives them on the plate's machine (`rangedSchema`).
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
