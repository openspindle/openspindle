import { z } from "zod"
import { COORDINATE_LIMIT } from "../../../primitives"
import type { SpecsOf } from "../../parameters"
import { ProbePlacementSchema } from "../../placement"

/** The grid's numeric parameters, in form order. */
export type GridField = "size" | "points" | "clearance"

/** A method's grid parameters on a machine (`ProbingMethod.parameters`). */
export type GridSpecs = SpecsOf<GridParams, GridField>

const storedLength = z.number().positive().max(COORDINATE_LIMIT)
const storedCount = z.int().min(2).max(COORDINATE_LIMIT)

/**
 * A height grid's parameters, as stored for any machine. Its method writes the NC from them at
 * compile time, within the ranges it gives them on the plate's machine
 * (`rangedSchema(GridParamsSchema, parameters)`).
 */
export const GridParamsSchema = z.strictObject({
  /** Grid extent from its start along X and along Y, mm. */
  size: z.tuple([storedLength, storedLength]),
  /** Endpoint-inclusive probe points along X and along Y. */
  points: z.tuple([storedCount, storedCount]),
  /** Lift above the detected surface between samples, mm. */
  clearance: storedLength,
  placement: ProbePlacementSchema,
  /** Pause after probing so the measured height map can be reviewed before continuing. */
  reviewAfterProbe: z.boolean(),
})

export type GridParams = z.infer<typeof GridParamsSchema>
