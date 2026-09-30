import { z } from "zod"
import type { Vec2 } from "../geometry/frame"
import { COORDINATE_LIMIT } from "../primitives"
import { defaultsOf, rangedSchema } from "../probing/parameters"
import type { SpecsOf } from "../probing/parameters"
import { ProbePlacementSchema } from "../probing/placement"

/**
 * What a 3D probing operation finds: a corner of the stock (outside) or of a pocket (inside),
 * or the centre of a pocket or of a boss such as the stock itself.
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
export type Probe3dField = "ballDiameter" | "distance" | "depth"

/** A machine's 3D probing parameters, which its probe defines (`OriginProbing.parameters`). */
export type Probe3dSpecs = SpecsOf<Probe3dParams, Probe3dField>

const storedLength = z.number().positive().max(COORDINATE_LIMIT)

/**
 * A built-in 3D probing operation, as stored for any machine. Its NC is derived from these
 * parameters at compile time, within the ranges of the machine's 3D probe
 * (`probe3dParamsSchema`). Every routine keeps every field; each reads those it needs.
 */
export const Probe3dParamsSchema = z.strictObject({
  routine: Probe3dRoutineSchema,
  /** The corner an outside or inside corner routine finds. */
  corner: Probe3dCornerSchema,
  /** The axes a centre routine centres. */
  axes: Probe3dAxesSchema,
  /** The probe's ball, whose radius the routine sets each touched side apart by, mm. */
  ballDiameter: storedLength,
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

export type Probe3dParams = z.infer<typeof Probe3dParamsSchema>

/** The parameters within the ranges of a machine's 3D probe, as its form and its NC take them. */
export function probe3dParamsSchema(parameters: Probe3dSpecs) {
  return rangedSchema(Probe3dParamsSchema, parameters)
}

/** A new operation's parameters: an outside corner at the front left, with the probe's defaults. */
export function defaultProbe3dParams(parameters: Probe3dSpecs): Probe3dParams {
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

/** Which of its numeric parameters a routine reads, and of the distance, in which axes. */
export type Probe3dFields = {
  readonly ballDiameter: boolean
  readonly distance: readonly [x: boolean, y: boolean]
  readonly depth: boolean
}

/**
 * The parameters a routine reads: the ball, the distance in the axes it touches sides in, both
 * for a corner and those a centre routine centres, and the depth, but for a pocket's centre,
 * which touches no top.
 */
export function probe3dFields(
  routine: Probe3dRoutine,
  axes: Probe3dAxes
): Probe3dFields {
  const corner = findsCorner(routine)
  return {
    ballDiameter: true,
    distance: [corner || axes !== "y", corner || axes !== "x"],
    depth: routine !== "pocket-center",
  }
}

/**
 * The directions from a corner into the stock (outside) or into the pocket (inside), in X and
 * Y: a left corner's stock or pocket lies to its right, a front corner's behind it.
 */
export function cornerInward(corner: Probe3dCorner): Vec2 {
  return [corner.endsWith("left") ? 1 : -1, corner.startsWith("front") ? 1 : -1]
}
