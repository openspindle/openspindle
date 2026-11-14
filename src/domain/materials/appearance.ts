import { z } from "zod"
import {
  SURFACE_FINISHES,
  surfaceMaterialOf,
  SurfaceMaterialSchema,
} from "./surface-material"

/** Display properties are optical; physical metadata never supplies feeds or speeds. */
export const MaterialAppearanceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  family: SurfaceMaterialSchema.optional(),
  color: z
    .string()
    .regex(/^#[\da-f]{6}$/i)
    .optional(),
  metalness: z.number().min(0).max(1).optional(),
  roughness: z.number().min(0.04).max(1).optional(),
  opacity: z.number().min(0.05).max(1).optional(),
  texture: z.enum(["none", "grain", "brushed", "fine"]).optional(),
  textureSize: z.number().min(0.1).max(1000).optional(),
  textureStrength: z.number().min(0).max(1).optional(),
  densityKgM3: z.number().positive().max(1_000_000).optional(),
  properties: z
    .array(z.object({ name: z.string().max(100), value: z.string().max(200) }))
    .max(20)
    .optional(),
  source: z.enum(["freecad", "manual"]).optional(),
})
export type MaterialAppearance = z.infer<typeof MaterialAppearanceSchema>

export function resolvedAppearance(
  name: string,
  appearance?: MaterialAppearance
) {
  const family =
    appearance?.family ?? surfaceMaterialOf(appearance?.name ?? name) ?? "matte"
  let pattern: "grain" | "brushed" | "fine" = "fine"
  if (family === "wood") pattern = "grain"
  if (family === "metal") pattern = "brushed"
  return {
    ...SURFACE_FINISHES[family],
    texture: pattern as "none" | "grain" | "brushed" | "fine",
    textureSize: 8,
    textureStrength: 0.12,
    opacity: 1,
    ...appearance,
    family,
  }
}
