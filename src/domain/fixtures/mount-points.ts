import { z } from "zod"
import { EntityIdSchema, Point3Schema, TextSchema } from "@/domain/primitives"
import type { Point3 } from "../nc/gcode"

/** The most mount points one model defines. */
export const MOUNT_POINT_LIMIT = 200

/**
 * A named point something mounts or lines up by: a hole, a corner, a datum. Its position is in
 * millimetres, in the frame of what it belongs to (a fixture's model, or the machine's bed).
 */
export const MountPointSchema = z.object({
  id: EntityIdSchema,
  name: TextSchema,
  position: Point3Schema,
})

/**
 * What a kit's mount point is, where a probe centres on it: a hole or a slot it centres in, or
 * a pin it centres on. Absent for the rest (corners, datums), and for points a definition gives.
 */
export type MountFeature = "hole" | "slot" | "pin"

export type MountPoint = z.infer<typeof MountPointSchema> & {
  readonly feature?: MountFeature
}

export const MountPointsSchema = z
  .array(MountPointSchema)
  .max(MOUNT_POINT_LIMIT)
  .refine(
    (points) => new Set(points.map((point) => point.id)).size === points.length,
    "Mount point ids repeat."
  )

type Box = { readonly min: Point3; readonly max: Point3 }

const CORNERS = [
  { id: "front-left", name: "Front-left", x: 0, y: 0 },
  { id: "front-right", name: "Front-right", x: 1, y: 0 },
  { id: "back-left", name: "Back-left", x: 0, y: 1 },
  { id: "back-right", name: "Back-right", x: 1, y: 1 },
] as const

/** A point of a box by its fractions along X, Y and Z (0 the minimum side, 1 the maximum). */
function boxPoint({ min, max }: Box, fractions: Point3): Point3 {
  return fractions.map(
    (fraction, axis) => min[axis] + (max[axis] - min[axis]) * fraction
  ) as Point3
}

/**
 * What a box is aligned by when nothing else is defined: its corners and the centres of its
 * bottom and top. Front is the minimum Y side, left the minimum X side.
 */
export function boxMountPoints(box: Box): MountPoint[] {
  const levels = [
    { id: "bottom", name: "bottom", z: 0 },
    { id: "top", name: "top", z: 1 },
  ] as const
  return [
    ...levels.flatMap((level) =>
      CORNERS.map((corner) => ({
        id: `${corner.id}-${level.id}`,
        name: `${corner.name} ${level.name}`,
        position: boxPoint(box, [corner.x, corner.y, level.z]),
      }))
    ),
    ...levels.map((level) => ({
      id: `${level.id}-center`,
      name: `${level.name === "bottom" ? "Bottom" : "Top"} center`,
      position: boxPoint(box, [0.5, 0.5, level.z]),
    })),
  ]
}

/** The corners and centre of a box's top face, where what rests on it lines up. */
export const boxTopPoints = (box: Box): MountPoint[] =>
  boxMountPoints(box).filter(
    (point) => point.id.startsWith("top") || point.id.endsWith("-top")
  )

/** The corners and centre of a box's bottom face, where it rests on what carries it. */
export const boxBottomPoints = (box: Box): MountPoint[] =>
  boxMountPoints(box).filter(
    (point) => point.id.startsWith("bottom") || point.id.endsWith("-bottom")
  )

/** A hole's X and Y on the face it opens in, in millimetres. */
export type HoleXY = readonly [number, number]

/**
 * A pattern of holes on a face at `height`, numbered from 1 (`dowel-1`, `dowel-2`…); `shift`
 * moves them from the frame they were measured in. They are holes, or the round ends of a slot.
 */
export function holePoints(
  prefix: string,
  name: string,
  holes: readonly HoleXY[],
  height: number,
  shift: HoleXY = [0, 0],
  feature: Extract<MountFeature, "hole" | "slot"> = "hole"
): MountPoint[] {
  return holes.map(([x, y], index) => ({
    id: `${prefix}-${index + 1}`,
    name,
    position: [x + shift[0], y + shift[1], height],
    feature,
  }))
}
