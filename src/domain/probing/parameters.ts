import { z } from "zod"

/**
 * A numeric parameter of a probing operation as its strategy describes it on a machine: its
 * label, default and the range it takes, which its form and its validation share.
 */
export type ParameterSpec = {
  readonly label: string
  readonly description?: string
  readonly default: number
  readonly min: number
  readonly max: number
  /** Input increment; values need not be multiples of it. */
  readonly step: number
  /** Lengths are millimetres and feeds mm/min; counts have none. */
  readonly unit?: "mm" | "mm/min"
  readonly axis?: "X" | "Y" | "Z"
  /** Only whole numbers, such as probe point counts. */
  readonly integer?: boolean
}

/** A parameter per axis, such as a grid's size: X, then Y. */
export type PairSpec = readonly [x: ParameterSpec, y: ParameterSpec]

/** A strategy's numeric parameters of a probing operation on a machine, by field, in form order. */
export type ParameterSpecs<TField extends string = string> = Readonly<
  Record<TField, ParameterSpec | PairSpec>
>

/** The fields of an operation's parameters a probe can give a range: numbers and pairs of them. */
export type NumericField<TParams> = {
  [TKey in keyof TParams]: TParams[TKey] extends
    number | readonly [number, number]
    ? TKey
    : never
}[keyof TParams]

/**
 * The specs of an operation's numeric parameters `TField`: one for a number, a pair for a value
 * per axis.
 */
export type SpecsOf<TParams, TField extends NumericField<TParams>> = {
  readonly [TKey in TField]: TParams[TKey] extends readonly [number, number]
    ? PairSpec
    : ParameterSpec
}

/** The values parameters take: a number, or a pair of them. */
export type SpecValues<TSpecs extends ParameterSpecs> = {
  -readonly [TField in keyof TSpecs]: TSpecs[TField] extends PairSpec
    ? [number, number]
    : number
}

/** Which parameters are read, by field: a number, or a pair per axis. */
export type SpecReads<TSpecs extends ParameterSpecs> = {
  readonly [TField in keyof TSpecs]: TSpecs[TField] extends PairSpec
    ? readonly [x: boolean, y: boolean]
    : boolean
}

const isPairSpec = (spec: ParameterSpec | PairSpec): spec is PairSpec =>
  Array.isArray(spec)

/** A value within its parameter's range, with messages that name its label. */
function specSchema(spec: ParameterSpec) {
  const unit = spec.unit ? ` ${spec.unit}` : ""
  const range = `${spec.label} must be from ${spec.min} to ${spec.max}${unit}.`
  const value = spec.integer
    ? z.int({ error: `${spec.label} must be a whole number.` })
    : z.number({ error: `${spec.label} is required.` })
  return value.min(spec.min, range).max(spec.max, range)
}

const fieldSchema = (spec: ParameterSpec | PairSpec) =>
  isPairSpec(spec)
    ? z.tuple([specSchema(spec[0]), specSchema(spec[1])])
    : specSchema(spec)

const schemas = new WeakMap<ParameterSpecs, WeakMap<z.ZodObject, z.ZodType>>()

/**
 * An operation's stored parameters within the ranges its strategy gives them on a machine, as its
 * form and its NC take them: the stored schema with each of `specs`' fields held to its range.
 */
export function rangedSchema<TParams, TField extends NumericField<TParams>>(
  stored: z.ZodObject & z.ZodType<TParams, TParams>,
  specs: SpecsOf<TParams, TField>
): z.ZodType<TParams, TParams> {
  let bySchema = schemas.get(specs)
  if (!bySchema) schemas.set(specs, (bySchema = new WeakMap()))
  const cached = bySchema.get(stored)
  if (cached) return cached as z.ZodType<TParams, TParams>
  const fields: ParameterSpecs = specs
  const shape = Object.fromEntries(
    Object.entries(fields).map(([field, spec]) => [field, fieldSchema(spec)])
  )
  const schema = stored.extend(shape) as z.ZodType as z.ZodType<
    TParams,
    TParams
  >
  bySchema.set(stored, schema)
  return schema
}

/** The parameters' defaults, as a new operation takes them. */
export function defaultsOf<TSpecs extends ParameterSpecs>(
  specs: TSpecs
): SpecValues<TSpecs> {
  return Object.fromEntries(
    Object.entries(specs).map(([field, spec]) => [
      field,
      isPairSpec(spec) ? [spec[0].default, spec[1].default] : spec.default,
    ])
  ) as SpecValues<TSpecs>
}

/** Every one of the parameters read, a pair in both axes. */
export function readsAll<TSpecs extends ParameterSpecs>(
  specs: TSpecs
): SpecReads<TSpecs> {
  return Object.fromEntries(
    Object.keys(specs).map((field) => [
      field,
      isPairSpec(specs[field]) ? [true, true] : true,
    ])
  ) as SpecReads<TSpecs>
}
