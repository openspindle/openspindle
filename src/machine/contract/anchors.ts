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

/** The most anchors of its user's a machine stores besides its own. */
export const ADDED_ANCHOR_LIMIT = 32

/**
 * An anchor its user added that the machine stores besides its own, such as a jig's corner: its
 * id, which never changes, and its X and Y from the machine's first anchor, in millimetres. Its
 * name and what it belongs to stay with the app. The id is letters, digits and dashes, as a
 * configuration value holds it.
 */
export const AddedAnchorSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/, "Use letters, digits and dashes."),
  offset: z.tuple([Coordinate, Coordinate]),
})
export type AddedAnchor = z.infer<typeof AddedAnchorSchema>

const uniqueAnchorIds = (anchors: readonly { readonly id: string }[]) =>
  new Set(anchors.map((anchor) => anchor.id)).size === anchors.length

/** The anchors read from the machine's configuration: positions, not a work offset. */
export const AnchorConfigurationSchema = z.object({
  source: z.literal("firmware-config"),
  anchors: z
    .array(MachineAnchorSchema)
    .min(1)
    .max(32)
    .refine(uniqueAnchorIds, "Each anchor needs its own id."),
  /**
   * The anchors its user added that it stores, each with the number of the place it is stored
   * in; absent when it cannot store them.
   */
  added: z
    .array(AddedAnchorSchema.extend({ slot: z.int().min(0).max(999) }).strict())
    .max(ADDED_ANCHOR_LIMIT)
    .refine(uniqueAnchorIds, "Each added anchor needs its own id.")
    .optional(),
  fetchedAt: z.number().nonnegative(),
})
export type AnchorConfiguration = z.infer<typeof AnchorConfigurationSchema>

/** A position of one of the machine's own anchors, by id, in machine XY millimetres. */
export const AnchorPositionSchema = MachineAnchorSchema.pick({
  id: true,
  x: true,
  y: true,
}).strict()
export type AnchorPosition = z.infer<typeof AnchorPositionSchema>

/**
 * What the machine is to store: its own anchors, each by id in machine XY millimetres, and the
 * anchors its user added, every one it is to keep (those it stores besides go); either or both.
 */
export const WriteAnchorsRequestSchema = z
  .strictObject({
    /** Bind a reviewed proposal to the connection whose anchors it used. */
    expectedConnectionId: z.uuid().optional(),
    /** Refuse a proposal if another read or write changed its reviewed anchors. */
    expectedAnchors: AnchorConfigurationSchema.optional(),
    anchors: z
      .array(AnchorPositionSchema)
      .min(1)
      .max(32)
      .refine(uniqueAnchorIds, "Each anchor needs its own id.")
      .optional(),
    added: z
      .array(AddedAnchorSchema)
      .max(ADDED_ANCHOR_LIMIT)
      .refine(uniqueAnchorIds, "Each added anchor needs its own id.")
      .optional(),
  })
  .refine(
    (request) => request.anchors !== undefined || request.added !== undefined,
    "Name the anchors to store."
  )
export type WriteAnchorsRequest = z.infer<typeof WriteAnchorsRequestSchema>

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
