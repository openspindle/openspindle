import { z } from "zod"
import {
  COORDINATE_LIMIT,
  DisplayNameSchema,
  hasControlCharacter,
} from "./primitives.ts"

const Coordinate = z.number().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT)

/**
 * A position the machine stores and names, such as a corner stock is set against, in machine
 * XY millimetres. Its id stays the same across reads: plates keep positions relative to it.
 */
export const MachineAnchorSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(200)
    .refine((id) => !hasControlCharacter(id), "Remove control characters."),
  name: DisplayNameSchema,
  x: Coordinate,
  y: Coordinate,
})
export type MachineAnchor = z.infer<typeof MachineAnchorSchema>

/** The anchors read from the machine's configuration: positions, not a work offset. */
export const AnchorConfigurationSchema = z.object({
  source: z.literal("firmware-config"),
  anchors: z
    .array(MachineAnchorSchema)
    .min(1)
    .max(32)
    .refine(
      (anchors) =>
        new Set(anchors.map((anchor) => anchor.id)).size === anchors.length,
      "Each anchor needs its own id."
    ),
  fetchedAt: z.number().nonnegative(),
})
export type AnchorConfiguration = z.infer<typeof AnchorConfigurationSchema>

/**
 * Where the machine's anchors are to be stored: every anchor it stores, by id, in machine XY
 * millimetres.
 */
export const WriteAnchorsRequestSchema = z.strictObject({
  anchors: z
    .array(MachineAnchorSchema.pick({ id: true, x: true, y: true }).strict())
    .min(1)
    .max(32)
    .refine(
      (anchors) =>
        new Set(anchors.map((anchor) => anchor.id)).size === anchors.length,
      "Each anchor needs its own id."
    ),
})
export type WriteAnchorsRequest = z.infer<typeof WriteAnchorsRequestSchema>
export type AnchorPosition = WriteAnchorsRequest["anchors"][number]

/**
 * The anchors a write stored, as the machine reads them back, and whether its own moves use
 * them only once it restarts.
 */
export const WriteAnchorsResultSchema = z.object({
  anchors: AnchorConfigurationSchema,
  afterRestart: z.boolean(),
})
export type WriteAnchorsResult = z.infer<typeof WriteAnchorsResultSchema>

export const isAnchorConfiguration = (
  value: unknown
): value is AnchorConfiguration =>
  AnchorConfigurationSchema.safeParse(value).success
