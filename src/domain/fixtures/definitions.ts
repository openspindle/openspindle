import { z } from "zod"
import { hasControlCharacter } from "@/machine/contract"
import { ModelIdSchema } from "@/domain/models/model"
import type { ModelRecord } from "@/domain/models/model"
import { EntityIdSchema, Point3Schema, toMicrometre } from "@/domain/primitives"
import type { Point3 } from "../nc/gcode"
import { SurfaceMaterialSchema } from "@/domain/materials/surface-material"
import { MountPointsSchema } from "./mount-points"
import { FixtureCompatibilitySchema } from "./compatibility"
import type { MountPoint } from "./mount-points"

/** The most fixtures a plate or a saved bed setup holds. */
export const FIXTURE_LIMIT = 32

/** The length limit of a fixture's name, as the Device tab takes it: above `TEXT_LIMIT`. */
export const FIXTURE_NAME_LIMIT = 256

export const FixtureKindSchema = z.enum([
  "bed",
  "clamp",
  "holder",
  "vise",
  "vacuum-bed",
  "wasteboard",
  "rotary",
  "other",
])
export type FixtureKind = z.infer<typeof FixtureKindSchema>

export const FixtureBoundsSchema = z.object({
  min: Point3Schema,
  max: Point3Schema,
})
export type FixtureBounds = z.infer<typeof FixtureBoundsSchema>

const BundledSourceSchema = z.object({
  kind: z.literal("bundled"),
  url: z.string().regex(/^\/models\/[a-z\d_-]+\.glb$/i),
})
const LibrarySourceSchema = z.object({
  kind: z.literal("library"),
  modelId: ModelIdSchema,
})

/** Where a fixture's mesh comes from: a model bundled with the app, or one in the Models library. */
export const FixtureMeshSourceSchema = z.discriminatedUnion("kind", [
  BundledSourceSchema,
  LibrarySourceSchema,
])
export type FixtureMeshSource = z.infer<typeof FixtureMeshSourceSchema>

/** What a fixture draws: a mesh, or a plain box (its model's bounds) in its colour. */
export const FixtureModelSourceSchema = z.discriminatedUnion("kind", [
  BundledSourceSchema,
  LibrarySourceSchema,
  z.object({ kind: z.literal("box") }),
])
export type FixtureModelSource = z.infer<typeof FixtureModelSourceSchema>

/**
 * Meshes are glTF (metres, Y up). Bounds and offset are millimetres, Z up; bounds include offset.
 * The frame's origin is the point the fixture is positioned by and turns about.
 */
export const FixtureModelSchema = z
  .object({
    source: FixtureModelSourceSchema,
    bounds: FixtureBoundsSchema,
    offset: Point3Schema,
    /**
     * How the mesh stands in the frame: turned by these angles (degrees, Euler XYZ like fixture
     * rotations) before `offset` moves it. Bounds and mount points are of the mesh as turned.
     * Absent: as its file has it.
     */
    orientation: Point3Schema.optional(),
    /**
     * Points the fixture mounts and lines up by, in the frame of `bounds`. Absent: the bundled
     * model's own points, or else the corners and centres of its box.
     */
    mountPoints: MountPointsSchema.optional(),
  })
  .refine(
    ({ bounds: { min, max } }) =>
      min.every((low, axis) => low <= max[axis]) &&
      max.some((high, axis) => high > min[axis]),
    { message: "The model's bounds hold nothing.", path: ["bounds"] }
  )
export type FixtureModel = z.infer<typeof FixtureModelSchema>

/** A shared fixture definition, with template placement defaults for bed setups. */
export const FixtureDefinitionSchema = z.object({
  id: EntityIdSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(FIXTURE_NAME_LIMIT)
    .refine((name) => !hasControlCharacter(name), "Remove control characters."),
  kind: FixtureKindSchema,
  /** Absent in older snapshots: compatible with all machine types. */
  compatibility: FixtureCompatibilitySchema.optional(),
  color: z.string().regex(/^#[\da-f]{6}$/i),
  /** What it is made of, as it is drawn; without one, as its model or its kind is. */
  material: SurfaceMaterialSchema.optional(),
  defaultEnabled: z.boolean(),
  defaultPosition: Point3Schema,
  defaultRotation: Point3Schema,
  model: FixtureModelSchema.nullable(),
})
export type FixtureDefinition = z.infer<typeof FixtureDefinitionSchema>

/** Each plate retains its own definition snapshot and placement, independent of library edits. */
export const FixtureInstanceSchema = z.object({
  id: EntityIdSchema,
  definition: FixtureDefinitionSchema,
  enabled: z.boolean(),
  position: Point3Schema,
  rotation: Point3Schema,
  /**
   * The stored anchor (its id) the fixture's anchor X and Y are kept relative to, as for the
   * stock. Absent or null: bed coordinates.
   */
  relativeTo: EntityIdSchema.nullable().optional(),
  /** A locked fixture keeps its position and rotation until it is unlocked (`isLocked`). */
  locked: z.boolean().optional(),
})
export type FixtureInstance = z.infer<typeof FixtureInstanceSchema>

/** The Models library model a definition uses, if any. */
export const libraryModelId = (definition: FixtureDefinition) =>
  definition.model?.source.kind === "library"
    ? definition.model.source.modelId
    : null

/**
 * A library model as a fixture: its origin at the centre of its footprint, on its underside,
 * so placing it puts the model on the bed where it is placed.
 */
export function fixtureModelOf(model: ModelRecord): FixtureModel {
  const { min, max } = model.bounds
  const offset = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]].map(
    toMicrometre
  ) as Point3
  const shift = (point: Point3) =>
    point.map((value, axis) => toMicrometre(value + offset[axis])) as Point3
  return {
    source: { kind: "library", modelId: model.id },
    bounds: { min: shift(min), max: shift(max) },
    offset,
  }
}

/** A box model of this size, framed like a library model: centred footprint, underside at 0. */
export function boxModel(
  width: number,
  depth: number,
  height: number
): FixtureModel {
  return {
    source: { kind: "box" },
    bounds: {
      min: [-width / 2, -depth / 2, 0],
      max: [width / 2, depth / 2, height],
    },
    offset: [0, 0, 0],
  }
}

/** A new fixture on a plate, placed where its definition puts it. */
export function fixtureInstance(
  definition: FixtureDefinition
): FixtureInstance {
  return {
    id: crypto.randomUUID(),
    definition: structuredClone(definition),
    enabled: true,
    position: [...definition.defaultPosition],
    rotation: [...definition.defaultRotation],
  }
}

/** The fixtures a new plate starts with: the definitions on new plates by default. */
export const defaultFixtureInstances = (
  definitions: readonly FixtureDefinition[]
): FixtureInstance[] =>
  definitions
    .filter((definition) => definition.defaultEnabled)
    .map(fixtureInstance)

/**
 * Rotates points of a fixture's frame as the fixture is rotated, or back with `inverse`. Matches
 * Three.js Euler XYZ, with application-facing angles expressed in degrees.
 */
function rotator(rotation: Point3, inverse = false) {
  const [rx, ry, rz] = rotation.map((angle) => (angle * Math.PI) / 180)
  const [cx, cy, cz] = [Math.cos(rx), Math.cos(ry), Math.cos(rz)]
  const [sx, sy, sz] = [Math.sin(rx), Math.sin(ry), Math.sin(rz)]
  const rows = [
    [cy * cz, -cy * sz, sy],
    [sx * sy * cz + cx * sz, cx * cz - sx * sy * sz, -sx * cy],
    [sx * sz - cx * sy * cz, cx * sy * sz + sx * cz, cx * cy],
  ]
  // A rotation's inverse is its transpose.
  const at = (row: number, column: number) =>
    inverse ? rows[column][row] : rows[row][column]
  return (point: Point3): Point3 =>
    [0, 1, 2].map((row) =>
      point.reduce((sum, value, column) => sum + at(row, column) * value, 0)
    ) as Point3
}

const UNTURNED: Point3 = [0, 0, 0]

/** Where a model's mesh is placed in a frame: turned by its orientation, then moved by its offset. */
type ModelFrame = Pick<FixtureModel, "offset" | "orientation">

const sameFrame = (a: ModelFrame, b: ModelFrame) =>
  [0, 1, 2].every(
    (axis) =>
      a.offset[axis] === b.offset[axis] &&
      (a.orientation ?? UNTURNED)[axis] === (b.orientation ?? UNTURNED)[axis]
  )

/**
 * Points of a model in one frame, as they are in another: they stay on the mesh, which the
 * frames turn and move differently. The same frame keeps them as they are.
 */
export function inModelFrame(
  points: readonly MountPoint[],
  from: ModelFrame,
  to: ModelFrame
): readonly MountPoint[] {
  if (sameFrame(from, to)) return points
  const back = rotator(from.orientation ?? UNTURNED, true)
  const turn = rotator(to.orientation ?? UNTURNED)
  return points.map((point) => {
    const onMesh = back(
      point.position.map((value, axis) => value - from.offset[axis]) as Point3
    )
    const position = turn(onMesh).map((value, axis) =>
      toMicrometre(value + to.offset[axis])
    ) as Point3
    return { ...point, position }
  })
}

/** Where a frame's origin is in its box: 0 at the minimum to 1 at the maximum, per axis. */
function originInBox({ min, max }: FixtureBounds): Point3 {
  return min.map((low, axis) => {
    const size = max[axis] - low
    return size > 0 ? -low / size : 0.5
  }) as Point3
}

/**
 * The model with one of its points (in its frame) as its origin, which the fixture is then
 * positioned by and turns about, and its mount points are measured from.
 */
export function withFixtureOrigin(
  model: FixtureModel,
  point: Point3
): FixtureModel {
  const shift = (value: Point3) =>
    value.map((coordinate, axis) =>
      toMicrometre(coordinate - point[axis])
    ) as Point3
  const framed: FixtureModel = {
    ...model,
    offset: shift(model.offset),
    bounds: { min: shift(model.bounds.min), max: shift(model.bounds.max) },
  }
  if (model.mountPoints)
    framed.mountPoints = [...inModelFrame(model.mountPoints, model, framed)]
  return framed
}

/**
 * The model with its mesh turned to `orientation`, which gives the mesh the box `turned` (its
 * millimetres before the frame's offset). The origin keeps its place in the box, the middle of
 * the underside for a new model, and the model's own points stay on the mesh.
 */
export function orientedFixtureModel(
  model: FixtureModel,
  orientation: Point3,
  turned: FixtureBounds
): FixtureModel {
  const place = originInBox(model.bounds)
  const offset = turned.min.map((low, axis) =>
    toMicrometre(-(low + (turned.max[axis] - low) * place[axis]))
  ) as Point3
  const shift = (value: Point3) =>
    value.map((coordinate, axis) =>
      toMicrometre(coordinate + offset[axis])
    ) as Point3
  const { orientation: _previous, mountPoints, ...rest } = model
  const oriented: FixtureModel = {
    ...rest,
    offset,
    bounds: { min: shift(turned.min), max: shift(turned.max) },
  }
  if (orientation.some((angle) => angle !== 0))
    oriented.orientation = orientation
  if (mountPoints)
    oriented.mountPoints = [...inModelFrame(mountPoints, model, oriented)]
  return oriented
}

/** A box model of another size, its origin at the same place in the box. */
export function withBoxSize(model: FixtureModel, size: Point3): FixtureModel {
  const place = originInBox(model.bounds)
  const min = size.map((length, axis) =>
    toMicrometre(-length * place[axis])
  ) as Point3
  const max = size.map((length, axis) =>
    toMicrometre(min[axis] + length)
  ) as Point3
  return { ...model, bounds: { min, max } }
}

/** A box's eight corners. */
export const boxCorners = ({ min, max }: FixtureBounds): Point3[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map(
    (corner) =>
      [0, 1, 2].map((axis) =>
        corner & (1 << axis) ? max[axis] : min[axis]
      ) as Point3
  )

/** The box that holds the points, of which there is at least one. */
export const pointsBounds = (points: readonly Point3[]): FixtureBounds => ({
  min: [0, 1, 2].map((axis) =>
    Math.min(...points.map((point) => point[axis]))
  ) as Point3,
  max: [0, 1, 2].map((axis) =>
    Math.max(...points.map((point) => point[axis]))
  ) as Point3,
})

/** The model's box where the fixture stands, enabled or not; null without a model. */
function placedBounds(instance: FixtureInstance): FixtureBounds | null {
  if (!instance.definition.model) return null
  const box = instance.definition.model.bounds
  const rotate = rotator(instance.rotation)
  const result: FixtureBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  }
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const height of [box.min[2], box.max[2]]) {
        const point = rotate([x, y, height])
        point.forEach((value, axis) => {
          result.min[axis] = Math.min(
            result.min[axis],
            value + instance.position[axis]
          )
          result.max[axis] = Math.max(
            result.max[axis],
            value + instance.position[axis]
          )
        })
      }
  return result
}

/** The box an enabled fixture occupies on the bed; null when it is disabled or has no model. */
export function fixtureBounds(instance: FixtureInstance): FixtureBounds | null {
  return instance.enabled ? placedBounds(instance) : null
}

/**
 * Where a point of a fixture's frame (the frame of its model's bounds) is on the bed, with the
 * fixture (or a definition's default placement) at `position`, turned by `rotation`.
 */
export function fixturePointOnBed(
  instance: Pick<FixtureInstance, "position" | "rotation">,
  point: Point3
): Point3 {
  return rotator(instance.rotation)(point).map(
    (value, axis) => value + instance.position[axis]
  ) as Point3
}

/** Each fixture with its name; repeated fixtures are numbered in order (Clamp, Clamp 2). */
export function namedFixtures<TInstance extends FixtureInstance>(
  fixtures: readonly TInstance[]
) {
  const counts = new Map<string, number>()
  return fixtures.map((instance) => {
    const { name } = instance.definition
    const count = (counts.get(name) ?? 0) + 1
    counts.set(name, count)
    return { instance, name: count > 1 ? `${name} ${count}` : name }
  })
}

/** Where a point of a model's frame is on the bed for a placement, to the micrometre. */
const placedPoint = (
  placement: Pick<FixtureInstance, "position" | "rotation">,
  point: Point3
) => fixturePointOnBed(placement, point).map(toMicrometre) as Point3

/**
 * A definition with one of its model's points (in the model's frame) as its origin, and that
 * point's place as its default position, so new plates put the fixture where they did.
 */
export function withDefinitionOrigin(
  definition: FixtureDefinition,
  point: Point3
): FixtureDefinition {
  if (!definition.model) return definition
  const placement = {
    position: definition.defaultPosition,
    rotation: definition.defaultRotation,
  }
  return {
    ...definition,
    model: withFixtureOrigin(definition.model, point),
    defaultPosition: placedPoint(placement, point),
  }
}

/**
 * A plate's fixture with one of its model's points as its origin, which it is positioned by and
 * turns about: its position becomes that point's, so it stays where it is. Its definition's
 * default position moves along, so resetting its placement still puts it where new plates do.
 */
export function withInstanceOrigin<TInstance extends FixtureInstance>(
  instance: TInstance,
  point: Point3
): TInstance {
  if (!instance.definition.model) return instance
  return {
    ...instance,
    definition: withDefinitionOrigin(instance.definition, point),
    position: placedPoint(instance, point),
  }
}

/** Beds carry the stock; a plate uses at most one. */
export const isBedKind = (kind: FixtureKind) =>
  kind === "bed" || kind === "vacuum-bed"

/** Whether a fixture is locked in place; beds stay in place without a lock. */
export const isLocked = (instance: FixtureInstance) =>
  instance.locked === true && !isBedKind(instance.definition.kind)

/** Beds and wasteboards are drawn matte, the rest metallic. */
export const isMatteKind = (kind: FixtureKind) =>
  kind === "bed" || kind === "wasteboard"

/**
 * A profile's definitions with one bed on new plates: the preferred one when it is, else the
 * first that is.
 */
export function withSingleDefaultBed(
  definitions: readonly FixtureDefinition[],
  preferredId?: string
): FixtureDefinition[] {
  const defaultBed = (item: FixtureDefinition) =>
    item.defaultEnabled && isBedKind(item.kind)
  const selected =
    definitions.find((item) => item.id === preferredId && defaultBed(item)) ??
    definitions.find(defaultBed)
  return definitions.map((item) =>
    defaultBed(item) && item.id !== selected?.id
      ? { ...item, defaultEnabled: false }
      : item
  )
}

/**
 * The top of the plate's highest bed, else `floor`, the machine's own bed top
 * (`FixtureKit.tableTop`). Support layers stack only on designated beds; clamps/rotary modules
 * never lift the stock.
 */
export function fixtureSupportHeight(
  fixtures: readonly FixtureInstance[],
  floor: number
) {
  return fixtures.reduce((height, instance) => {
    if (!isBedKind(instance.definition.kind)) return height
    return Math.max(height, fixtureBounds(instance)?.max[2] ?? floor)
  }, floor)
}

/**
 * The height stock rests on where it lies (from `corner`, its front-left X and Y, over its
 * footprint): the top of the plate's bed, or of the highest wasteboard under it, else `floor`,
 * the machine's own bed top (`FixtureKit.tableTop`). A bed covers the table, so it carries the
 * stock wherever it is.
 */
export function stockSupportHeight(
  fixtures: readonly FixtureInstance[],
  corner: readonly number[],
  footprint: { readonly width: number; readonly depth: number } | null,
  floor: number
) {
  const [x, y] = corner
  const width = footprint?.width ?? 0
  const depth = footprint?.depth ?? 0
  return fixtures.reduce((height, instance) => {
    const { kind } = instance.definition
    const bed = isBedKind(kind)
    const box = bed || kind === "wasteboard" ? fixtureBounds(instance) : null
    if (!box) return height
    const under =
      bed ||
      (box.min[0] < x + width &&
        x < box.max[0] &&
        box.min[1] < y + depth &&
        y < box.max[1])
    return under ? Math.max(height, box.max[2]) : height
  }, floor)
}
