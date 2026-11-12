import { z } from "zod"
import { Point3Schema, COORDINATE_LIMIT } from "../primitives"
import { MaterialAppearanceSchema } from "../materials/appearance"

export const REFERENCE_TRIANGLES = 100_000
const coordinates = z
  .array(z.number().finite().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT))
  .min(9)
  .max(REFERENCE_TRIANGLES * 9)
const PartSchema = z
  .object({
    name: z.string().min(1).max(200),
    positions: coordinates,
    indices: z
      .array(z.int().nonnegative())
      .min(3)
      .max(REFERENCE_TRIANGLES * 3),
    material: MaterialAppearanceSchema.optional(),
  })
  .superRefine((part, ctx) => {
    if (
      part.positions.length % 3 ||
      part.indices.length % 3 ||
      part.indices.some((i) => i >= part.positions.length / 3)
    )
      ctx.addIssue({
        code: "custom",
        message: "Reference mesh needs valid indexed triangles.",
      })
  })
/** Vertices are mm, Z up, in the NC work frame. Placement is display-only. */
export const ReferenceModelSchema = z
  .object({
    name: z.string().min(1).max(200),
    units: z.literal("mm"),
    frame: z.literal("work"),
    parts: z.array(PartSchema).min(1).max(32),
    offset: Point3Schema,
    rotation: Point3Schema,
    scale: z.number().min(0.001).max(1000),
  })
  .superRefine((model, ctx) => {
    if (
      model.parts.reduce((sum, p) => sum + p.indices.length / 3, 0) >
      REFERENCE_TRIANGLES
    )
      ctx.addIssue({
        code: "custom",
        message: "Reference models support at most 100,000 triangles.",
      })
  })
export type ReferenceModel = z.infer<typeof ReferenceModelSchema>
