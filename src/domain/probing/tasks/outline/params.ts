import { z } from "zod"
import { COORDINATE_LIMIT } from "../../../primitives"
import type { SpecsOf } from "../../parameters"

/** The trace's numeric parameters. */
export type OutlineField = "travelZ" | "feed"

/** A strategy's trace parameters on a machine (`ProbingStrategy.parameters`). */
export type OutlineSpecs = SpecsOf<OutlineParams, OutlineField>

/** A sanity bound for stored feeds, mm/min; the strategy sets the usable range. */
const storedFeed = z.number().positive().max(100_000)

/**
 * An outline's parameters, as stored for any machine. Its strategy traces the plate's toolpath
 * bounds at compile time, within the ranges it gives them on the plate's machine (`rangedSchema`).
 */
export const OutlineParamsSchema = z.strictObject({
  /** Machine Z of the trace (G53), mm. */
  travelZ: z.number().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT),
  /** Feed of the traced edges, mm/min. */
  feed: storedFeed,
  /** Pause after the trace so the outline can be checked before the job goes on. */
  pauseAfterScan: z.boolean(),
})

export type OutlineParams = z.infer<typeof OutlineParamsSchema>
