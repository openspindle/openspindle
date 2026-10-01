import { z } from "zod"
import { Point3Schema, TextSchema } from "../primitives"

const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a SHA-256 digest.")

const MiB = 1024 * 1024

/** Uploaded CAD files and the meshes the viewer draws from them. */
export const MODEL_LIMITS = {
  /** An uploaded STEP or GLB file. */
  sourceBytes: 64 * MiB,
  /** A stored display mesh (binary glTF). */
  meshBytes: 32 * MiB,
  /** Triangles in one display mesh. */
  triangles: 1_000_000,
  /** Models in the library. */
  models: 500,
} as const

/** A model is its display mesh: the SHA-256 of the mesh's GLB bytes, verifiable anywhere. */
export const ModelIdSchema = Sha256Schema
export type ModelId = z.infer<typeof ModelIdSchema>

/** The file types the library reads, by extension. */
export const MODEL_EXTENSIONS = {
  step: ["step", "stp"],
  glb: ["glb"],
} as const
export const ModelFormatSchema = z.enum(["step", "glb"])
export type ModelFormat = z.infer<typeof ModelFormatSchema>
/** The file input's `accept`: every extension the library reads. */
export const MODEL_ACCEPT = Object.values(MODEL_EXTENSIONS)
  .flat()
  .map((extension) => `.${extension}`)
  .join(",")

/** A file's format from its name; null when the library does not read it. */
export function modelFormatOf(fileName: string): ModelFormat | null {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? ""
  for (const format of ModelFormatSchema.options)
    if ((MODEL_EXTENSIONS[format] as readonly string[]).includes(extension))
      return format
  return null
}

/** Millimetres, Z up: the model as authored, before any placement. */
export const ModelBoundsSchema = z
  .object({ min: Point3Schema, max: Point3Schema })
  .refine(
    ({ min, max }) => min.every((value, axis) => value <= max[axis]),
    "Model bounds must not be inverted."
  )
export type ModelBounds = z.infer<typeof ModelBoundsSchema>

/** The uploaded file, kept so the mesh can be rebuilt; models that came with a project have none. */
export const ModelSourceSchema = z.object({
  format: ModelFormatSchema,
  fileName: TextSchema,
  bytes: z.int().positive().max(MODEL_LIMITS.sourceBytes),
  sha256: Sha256Schema,
})
export type ModelSource = z.infer<typeof ModelSourceSchema>

/** One library entry; its mesh (and source file, when kept) are stored beside it. */
export const ModelRecordSchema = z.object({
  id: ModelIdSchema,
  name: TextSchema,
  source: ModelSourceSchema.nullable(),
  mesh: z.object({
    bytes: z.int().positive().max(MODEL_LIMITS.meshBytes),
    triangles: z.int().positive().max(MODEL_LIMITS.triangles),
  }),
  bounds: ModelBoundsSchema,
  /** When the model entered this library, in milliseconds since the epoch. */
  addedAt: z.int().nonnegative(),
})
export type ModelRecord = z.infer<typeof ModelRecordSchema>
