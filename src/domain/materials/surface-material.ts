import { z } from "zod"

/** What stock or a fixture is made of, as it is drawn. */
export const SURFACE_MATERIALS = ["metal", "plastic", "wood", "matte"] as const
export const SurfaceMaterialSchema = z.enum(SURFACE_MATERIALS)
export type SurfaceMaterial = z.infer<typeof SurfaceMaterialSchema>

/** How a surface takes light: how metallic it is and how rough, from 0 to 1. */
export type SurfaceFinish = {
  readonly metalness: number
  readonly roughness: number
}

/** Each material by its name, and its finish. */
export const SURFACE_FINISHES: Readonly<
  Record<SurfaceMaterial, SurfaceFinish & { readonly label: string }>
> = {
  metal: { label: "Metal", metalness: 0.55, roughness: 0.35 },
  plastic: { label: "Plastic", metalness: 0, roughness: 0.3 },
  wood: { label: "Wood", metalness: 0, roughness: 0.85 },
  matte: { label: "Matte", metalness: 0, roughness: 0.95 },
}

/**
 * What a stock's material name says it is made of, read loosely, as the library and CAM name
 * materials ("Metal", "Aluminum 6061", "Birch plywood", "MDF", "Clear acrylic"); null where it
 * names nothing known.
 */
export function surfaceMaterialOf(name: string): SurfaceMaterial | null {
  if (/metal|alumin|steel|brass|copper|bronze|titan|iron/i.test(name))
    return "metal"
  if (/wood|ply|mdf|hdf|oak|birch|beech|walnut|maple|pine|bamboo/i.test(name))
    return "wood"
  if (
    /plastic|acryl|pmma|\bpom\b|delrin|acetal|hdpe|uhmw|\babs\b|nylon|pvc|polycarb/i.test(
      name
    )
  )
    return "plastic"
  return null
}
