import { z } from "zod"
import { COORDINATE_LIMIT } from "@/domain/primitives"

/** Persisted library shapes shared by the UI and its runtime validators. */
export const STOCK_MATERIALS = ["Wood", "Metal", "Plastic", "PCB"] as const

/** What stock a program describes is called while its material is not known. */
export const UNSPECIFIED_STOCK_NAME = "Unspecified material"

/** Stored stock is bounded like bed coordinates; the machine's work area bounds it where it is edited. */
const dimension = (label: string) =>
  z
    .number({ error: `${label} is required.` })
    .positive(`${label} must be greater than 0 mm.`)
    .max(COORDINATE_LIMIT, `${label} must be at most ${COORDINATE_LIMIT} mm.`)

/** A stock block: the material machined, its size on the bed, and its display colour. */
export const StockSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1, "Enter a stock name."),
  material: z.string().trim().min(1),
  width: dimension("Width"),
  depth: dimension("Depth"),
  height: dimension("Height"),
  color: z.string().regex(/^#(?:[\da-f]{3}|[\da-f]{6})$/i),
})
export type Stock = z.infer<typeof StockSchema>

/** Validate every field read by React or Three.js before restoring local data. */
export const isStock = (value: unknown): value is Stock =>
  StockSchema.safeParse(value).success
