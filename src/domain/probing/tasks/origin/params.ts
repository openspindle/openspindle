import { z } from "zod"
import type { Vec2 } from "../../../geometry/frame"
import { COORDINATE_LIMIT } from "../../../primitives"
import { defaultsOf, rangedSchema } from "../../parameters"
import type { SpecsOf } from "../../parameters"
import { ProbePlacementSchema } from "../../placement"
import type { StrategyId } from "../../strategy"

/**
 * What a 3D probing operation finds: a corner of the stock (outside) or of a pocket (inside),
 * or the centre of a pocket or of a boss such as the stock itself. Each is an origin strategy of
 * the same id, which decides it (`originRoutine`).
 */
export const PROBE_3D_ROUTINES = [
  "outside-corner",
  "inside-corner",
  "pocket-center",
  "boss-center",
] as const
export const Probe3dRoutineSchema = z.enum(PROBE_3D_ROUTINES)
export type Probe3dRoutine = z.infer<typeof Probe3dRoutineSchema>

export const PROBE_3D_ROUTINE_LABELS: Readonly<Record<Probe3dRoutine, string>> =
  {
    "outside-corner": "Outside corner",
    "inside-corner": "Inside corner",
    "pocket-center": "Pocket center",
    "boss-center": "Boss center",
  }

/** The routine an origin strategy runs; null for a strategy of another task. */
export function originRoutine(id: StrategyId): Probe3dRoutine | null {
  return PROBE_3D_ROUTINES.find((routine) => routine === id) ?? null
}

/** The origin strategy that runs a routine. */
export const originStrategy = (routine: Probe3dRoutine): StrategyId => routine

/** A corner as seen from the front of the machine: front is −Y, left is −X. */
export const PROBE_3D_CORNERS = [
  "front-left",
  "front-right",
  "back-left",
  "back-right",
] as const
export const Probe3dCornerSchema = z.enum(PROBE_3D_CORNERS)
export type Probe3dCorner = z.infer<typeof Probe3dCornerSchema>

export const PROBE_3D_CORNER_LABELS: Readonly<Record<Probe3dCorner, string>> = {
  "front-left": "Front-left",
  "front-right": "Front-right",
  "back-left": "Back-left",
  "back-right": "Back-right",
}

/** The axes a centre routine centres: both, or X or Y alone. */
export const PROBE_3D_AXES = ["xy", "x", "y"] as const
export const Probe3dAxesSchema = z.enum(PROBE_3D_AXES)
export type Probe3dAxes = z.infer<typeof Probe3dAxesSchema>

export const PROBE_3D_AXES_LABELS: Readonly<Record<Probe3dAxes, string>> = {
  xy: "X and Y",
  x: "X only",
  y: "Y only",
}

/** The routine's numeric parameters, in form order. */
export type OriginField = "distance" | "depth"

/** A method's 3D probing parameters on a machine (`ProbingMethod.parameters`). */
export type OriginSpecs = SpecsOf<OriginParams, OriginField>

const storedLength = z.number().positive().max(COORDINATE_LIMIT)

/**
 * A built-in 3D probing operation, as stored for any machine. Its NC is derived from these
 * parameters at compile time, within the ranges of its method (`originParamsSchema`), and from
 * the ball of the probe it selects. Every routine keeps every field; each reads those it needs.
 */
export const OriginParamsSchema = z.strictObject({
  /** What it finds: its strategy's routine (`originRoutine`), which choosing the strategy sets. */
  routine: Probe3dRoutineSchema,
  /** The corner an outside or inside corner routine finds. */
  corner: Probe3dCornerSchema,
  /** The axes a centre routine centres. */
  axes: Probe3dAxesSchema,
  /**
   * How far the probe moves out from where it starts before it comes down beside a side and
   * touches back (corners and bosses), or searches for each wall (pockets), in X and in Y, mm.
   */
  distance: z.tuple([storedLength, storedLength]),
  /** How far below the probed top the sides are touched (corners and bosses), mm. */
  depth: storedLength,
  /**
   * Where the routine starts: the probe position, or a stored anchor plus an offset, and the
   * height on the bed the probe comes down to first, if any.
   */
  placement: ProbePlacementSchema,
})

export type OriginParams = z.infer<typeof OriginParamsSchema>

/** The parameters within the ranges of a method, as its form and its NC take them. */
export function originParamsSchema(parameters: OriginSpecs) {
  return rangedSchema(OriginParamsSchema, parameters)
}

/**
 * A new operation's parameters: an outside corner at the front left, with the method's defaults.
 * The operation's strategy sets the routine (`originRoutine`).
 */
export function defaultOriginParams(parameters: OriginSpecs): OriginParams {
  return {
    routine: "outside-corner",
    corner: "front-left",
    axes: "xy",
    ...defaultsOf(parameters),
    placement: { kind: "probe-position" },
  }
}

/** The corner routines; the others find a centre. */
export const findsCorner = (routine: Probe3dRoutine) =>
  routine === "outside-corner" || routine === "inside-corner"

/**
 * Whether a routine sets work Z0 on the top it touches first: all but the pocket's centre,
 * which touches no top.
 */
export const setsWorkZ = (routine: Probe3dRoutine) =>
  routine !== "pocket-center"

/**
 * Which of work X0 and Y0 a routine sets, in the axes it touches sides in: both for a corner, and
 * those a centre routine centres.
 */
export function setsWorkXY(
  routine: Probe3dRoutine,
  axes: Probe3dAxes
): readonly [x: boolean, y: boolean] {
  const corner = findsCorner(routine)
  return [corner || axes !== "y", corner || axes !== "x"]
}

/** Which of its numeric parameters a routine reads, and of the distance, in which axes. */
export type OriginFields = {
  readonly distance: readonly [x: boolean, y: boolean]
  readonly depth: boolean
}

/**
 * The parameters a routine reads besides the probe's ball: the distance in the axes it touches
 * sides in (`setsWorkXY`), and the depth below the top it touches (`setsWorkZ`).
 */
export function originFields(
  routine: Probe3dRoutine,
  axes: Probe3dAxes
): OriginFields {
  return {
    distance: setsWorkXY(routine, axes),
    depth: setsWorkZ(routine),
  }
}

/**
 * The directions from a corner into the stock (outside) or into the pocket (inside), in X and
 * Y: a left corner's stock or pocket lies to its right, a front corner's behind it.
 */
export function cornerInward(corner: Probe3dCorner): Vec2 {
  return [corner.endsWith("left") ? 1 : -1, corner.startsWith("front") ? 1 : -1]
}
