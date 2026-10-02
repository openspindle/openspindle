import { z } from "zod"
import { ItemEdgeRefSchema } from "../../../plate/item-edges"
import { COORDINATE_LIMIT } from "../../../primitives"
import type { SpecsOf } from "../../parameters"

/** The trace's numeric parameters. */
export type OutlineField = "travelZ" | "feed"

/** A method's trace parameters on a machine (`ProbingMethod.parameters`). */
export type OutlineSpecs = SpecsOf<OutlineParams, OutlineField>

/** A sanity bound for stored feeds, mm/min; the method sets the usable range. */
const storedFeed = z.number().positive().max(100_000)

/** The most edges one outline traces. */
export const OUTLINE_EDGE_LIMIT = 32

/**
 * What an outline traces: the plate's toolpath bounds, in work coordinates, or edges of its
 * stock and fixtures (`ItemEdgeRef`), where its setup puts them.
 */
export const OutlineTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("toolpath") }),
  z.strictObject({
    kind: z.literal("edges"),
    edges: z.array(ItemEdgeRefSchema).max(OUTLINE_EDGE_LIMIT),
  }),
])
export type OutlineTarget = z.infer<typeof OutlineTargetSchema>

/**
 * An outline's parameters, as stored for any machine. Its method traces its target at compile
 * time, within the ranges it gives them on the plate's machine (`rangedSchema`).
 */
export const OutlineParamsSchema = z.strictObject({
  /** Machine Z of the trace (G53), mm. */
  travelZ: z.number().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT),
  /** Feed of the traced edges, mm/min. */
  feed: storedFeed,
  /** Pause after the trace so the outline can be checked before the job goes on. */
  pauseAfterScan: z.boolean(),
  /** What it traces; absent, the toolpath bounds. */
  target: OutlineTargetSchema.optional(),
})

export type OutlineParams = z.infer<typeof OutlineParamsSchema>

/** What an outline traces, the toolpath bounds where it does not say. */
export const outlineTarget = (params: Pick<OutlineParams, "target">) =>
  params.target ?? ({ kind: "toolpath" } as const)
