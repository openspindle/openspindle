import { z } from "zod"
import { AUTO_LEVEL_COORDINATE_LIMIT } from "../auto-level/params"
import { ProbePlacementSchema } from "../probing/placement"

/** The touch-off parameters, in form order. */
export const AUTO_Z_HEIGHT_FIELDS = ["probeTravel", "clearance"] as const
export type AutoZHeightField = (typeof AUTO_Z_HEIGHT_FIELDS)[number]

/** One touch-off parameter, described like an auto-level grid parameter. */
export type AutoZHeightParameter = {
  label: string
  default: number
  min: number
  max: number
  /** Input increment; values need not be multiples of it. */
  step: number
  unit: "mm"
  axis: "Z"
  description: string
}

/** A machine's touch-off parameters, which its probe defines (`TouchOff.parameters`). */
export type AutoZHeightParameters = Readonly<
  Record<AutoZHeightField, AutoZHeightParameter>
>

function lengthSchema({ label, min, max, unit }: AutoZHeightParameter) {
  const range = `${label} must be from ${min} to ${max} ${unit}.`
  return z
    .number({ error: `${label} is required.` })
    .min(min, range)
    .max(max, range)
}

const storedLength = z.number().positive().max(AUTO_LEVEL_COORDINATE_LIMIT)

/**
 * A built-in auto Z-height operation, as stored for any machine. Its NC is derived from these
 * parameters at compile time, within the ranges of the machine's probe (`autoZHeightParamsSchema`).
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

const machineSchemas = new WeakMap<
  AutoZHeightParameters,
  z.ZodType<AutoZHeightParams, AutoZHeightParams>
>()

/** The parameters within the ranges of a machine's probe, as its form and its NC take them. */
export function autoZHeightParamsSchema(
  parameters: AutoZHeightParameters
): z.ZodType<AutoZHeightParams, AutoZHeightParams> {
  const cached = machineSchemas.get(parameters)
  if (cached) return cached
  const schema = z.strictObject({
    probeTravel: lengthSchema(parameters.probeTravel),
    clearance: lengthSchema(parameters.clearance),
    placement: ProbePlacementSchema,
  })
  machineSchemas.set(parameters, schema)
  return schema
}

/** A new operation's parameters: the defaults of the machine's probe. */
export function defaultAutoZHeightParams(
  parameters: AutoZHeightParameters
): AutoZHeightParams {
  return {
    probeTravel: parameters.probeTravel.default,
    clearance: parameters.clearance.default,
    placement: { kind: "probe-position" },
  }
}
