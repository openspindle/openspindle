import { z } from "zod"
import { COORDINATE_LIMIT } from "../primitives"
import { ProbePlacementSchema } from "../probing/placement"

/** The rectangular grid's parameters, in form order. */
export const AUTO_LEVEL_GRID_FIELDS = [
  "width",
  "depth",
  "columns",
  "rows",
  "clearance",
] as const
export type AutoLevelGridField = (typeof AUTO_LEVEL_GRID_FIELDS)[number]

/** One grid parameter. Its bounds and display metadata are shared by the form and validator. */
export type AutoLevelGridParameter = {
  label: string
  default: number
  min: number
  max: number
  /** Input increment; values need not be multiples of it. */
  step: number
  /** Lengths are millimetres; probe-point counts have no unit. */
  unit?: "mm"
  axis?: "X" | "Y" | "Z"
  description?: string
}

/** A machine's grid parameters, which its probe defines (`GridProbing.parameters`). */
export type AutoLevelGridParameters = Readonly<
  Record<AutoLevelGridField, AutoLevelGridParameter>
>

/** Anchor offsets and anchored grid corners share the stored anchors' range. */
export const AUTO_LEVEL_COORDINATE_LIMIT = COORDINATE_LIMIT

/** Millimetres as NC words carry them: rounded to 6 decimals. */
export const roundMillimetres = (value: number) => Number(value.toFixed(6))

/** Plain decimal millimetres without exponent notation, for NC words and messages. */
export const formatMillimetres = (value: number) =>
  String(roundMillimetres(value))

function rangeMessage(label: string, min: number, max: number, unit?: string) {
  const suffix = unit ? ` ${unit}` : ""
  return `${label} must be from ${min} to ${max}${suffix}.`
}

function lengthSchema({ label, min, max, unit }: AutoLevelGridParameter) {
  const range = rangeMessage(label, min, max, unit)
  return z
    .number({ error: `${label} is required.` })
    .min(min, range)
    .max(max, range)
}

function countSchema({ label, min, max }: AutoLevelGridParameter) {
  const range = rangeMessage(label, min, max)
  return z
    .int({ error: `${label} must be a whole number.` })
    .min(min, range)
    .max(max, range)
}

const storedLength = z.number().positive().max(AUTO_LEVEL_COORDINATE_LIMIT)
const storedCount = z.int().min(2).max(AUTO_LEVEL_COORDINATE_LIMIT)

/**
 * A built-in auto-level operation, as stored for any machine. Its NC is derived from these
 * parameters at compile time, within the ranges of the machine's probe (`autoLevelParamsSchema`).
 */
export const AutoLevelParamsSchema = z.strictObject({
  /** Grid extent along X from its start, mm. */
  width: storedLength,
  /** Grid extent along Y from its start, mm. */
  depth: storedLength,
  /** Endpoint-inclusive probe points along X. */
  columns: storedCount,
  /** Endpoint-inclusive probe points along Y. */
  rows: storedCount,
  /** Lift above the detected surface between samples, mm. */
  clearance: storedLength,
  placement: ProbePlacementSchema,
  /** Pause after probing so the measured height map can be reviewed before continuing. */
  reviewAfterProbe: z.boolean(),
})

export type AutoLevelParams = z.infer<typeof AutoLevelParamsSchema>

const machineSchemas = new WeakMap<
  AutoLevelGridParameters,
  z.ZodType<AutoLevelParams, AutoLevelParams>
>()

/** The parameters within the ranges of a machine's probe, as its form and its NC take them. */
export function autoLevelParamsSchema(
  parameters: AutoLevelGridParameters
): z.ZodType<AutoLevelParams, AutoLevelParams> {
  const cached = machineSchemas.get(parameters)
  if (cached) return cached
  const schema = z.strictObject({
    width: lengthSchema(parameters.width),
    depth: lengthSchema(parameters.depth),
    columns: countSchema(parameters.columns),
    rows: countSchema(parameters.rows),
    clearance: lengthSchema(parameters.clearance),
    placement: ProbePlacementSchema,
    reviewAfterProbe: z.boolean(),
  })
  machineSchemas.set(parameters, schema)
  return schema
}

/** A new operation's parameters: the defaults of the machine's probe. */
export function defaultAutoLevelParams(
  grid: AutoLevelGridParameters
): AutoLevelParams {
  return {
    width: grid.width.default,
    depth: grid.depth.default,
    columns: grid.columns.default,
    rows: grid.rows.default,
    clearance: grid.clearance.default,
    placement: { kind: "probe-position" },
    reviewAfterProbe: true,
  }
}
