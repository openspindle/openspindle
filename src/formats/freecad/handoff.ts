import { z } from "zod"
import { ReferenceModelSchema } from "@/domain/models/reference"
import { MaterialAppearanceSchema } from "@/domain/materials/appearance"
import { Point3Schema } from "@/domain/primitives"
import { webCryptoSha256 } from "@/lib/sha256"

export const FreecadHandoffSchema = z.object({
  schema: z.literal("freecad-openspindle-job/1"),
  program: z.object({
    name: z.string().min(1).max(200),
    nc: z
      .string()
      .min(1)
      .max(10 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f\d]{64}$/),
  }),
  reference: ReferenceModelSchema,
  material: MaterialAppearanceSchema.optional(),
  stock: z
    .object({ min: Point3Schema, max: Point3Schema })
    .refine((s) => s.max.every((v, i) => v > s.min[i])),
})
export type FreecadHandoff = z.infer<typeof FreecadHandoffSchema>
export async function readFreecadHandoff(
  text: string
): Promise<FreecadHandoff> {
  const bundle = FreecadHandoffSchema.parse(JSON.parse(text))
  if (
    (await webCryptoSha256(new TextEncoder().encode(bundle.program.nc))) !==
    bundle.program.sha256
  )
    throw new Error("The FreeCAD job's program checksum does not match.")
  return bundle
}
