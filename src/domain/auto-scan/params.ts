import { z } from "zod"
import { COORDINATE_LIMIT } from "../primitives"

/** The trace parameters, in form order. */
export const AUTO_SCAN_FIELDS = ["travelZ", "feed"] as const
export type AutoScanField = (typeof AUTO_SCAN_FIELDS)[number]

/** One trace parameter, described like the other probing parameters. */
export type AutoScanParameter = {
  label: string
  default: number
  min: number
  max: number
  /** Input increment; values need not be multiples of it. */
  step: number
  unit: "mm" | "mm/min"
  axis?: "Z"
  description: string
}

/** A machine's trace parameters, which its probe defines (`OutlineTrace.parameters`). */
export type AutoScanParameters = Readonly<
  Record<AutoScanField, AutoScanParameter>
>

function measureSchema({ label, min, max, unit }: AutoScanParameter) {
  const range = `${label} must be from ${min} to ${max} ${unit}.`
  return z
    .number({ error: `${label} is required.` })
    .min(min, range)
    .max(max, range)
}

/** A sanity bound for stored feeds, mm/min; the machine's probe sets the usable range. */
const storedFeed = z.number().positive().max(100_000)

/**
 * A built-in auto-scan operation, as stored for any machine. Its NC traces the plate's toolpath
 * bounds at compile time, within the ranges of the machine's probe (`autoScanParamsSchema`).
 */
export const AutoScanParamsSchema = z.strictObject({
  /** Machine Z of the trace (G53), mm. */
  travelZ: z.number().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT),
  /** Feed of the traced edges, mm/min. */
  feed: storedFeed,
  /** Pause after the trace so the outline can be checked before the job goes on. */
  pauseAfterScan: z.boolean(),
})

export type AutoScanParams = z.infer<typeof AutoScanParamsSchema>

const machineSchemas = new WeakMap<
  AutoScanParameters,
  z.ZodType<AutoScanParams, AutoScanParams>
>()

/** The parameters within the ranges of a machine's probe, as its form and its NC take them. */
export function autoScanParamsSchema(
  parameters: AutoScanParameters
): z.ZodType<AutoScanParams, AutoScanParams> {
  const cached = machineSchemas.get(parameters)
  if (cached) return cached
  const schema = z.strictObject({
    travelZ: measureSchema(parameters.travelZ),
    feed: measureSchema(parameters.feed),
    pauseAfterScan: z.boolean(),
  })
  machineSchemas.set(parameters, schema)
  return schema
}

/** A new operation's parameters: the defaults of the machine's probe. */
export function defaultAutoScanParams(
  parameters: AutoScanParameters
): AutoScanParams {
  return {
    travelZ: parameters.travelZ.default,
    feed: parameters.feed.default,
    pauseAfterScan: true,
  }
}
