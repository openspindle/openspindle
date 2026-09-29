import { z } from "zod"
import { NcSchema, OPERATION_LIMITS } from "../../domain/operations/operation"
import { TextSchema } from "../../domain/primitives"
import { hasControlCharacter } from "../../machine/contract/index.ts"
import { hasFileExtension } from "./files"

export const FUSION_MAX_NC_BYTES = OPERATION_LIMITS.ncBytes
export const FUSION_MAX_PROGRAMS = 100

/** A one-use code shown only after Connect to OpenSpindle is clicked in Fusion. */
export const FusionOtpSchema = z
  .string()
  .regex(/^\d{6}$/, "Enter the six-digit code shown in Fusion 360.")

export const FusionPairingRequestSchema = z.strictObject({
  requestId: z.uuid(),
  expiresAt: z.number().int().positive(),
})
export type FusionPairingRequest = z.infer<typeof FusionPairingRequestSchema>

export const FusionConnectionSnapshotSchema = z.strictObject({
  connected: z.boolean(),
  request: FusionPairingRequestSchema.nullable(),
  discoveryError: z.string().max(500).nullable(),
})
export type FusionConnectionSnapshot = z.infer<
  typeof FusionConnectionSnapshotSchema
>

export const FusionProgramIdSchema = z.uuid()

const FusionFileNameSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (name) =>
      /^[^./\\:<>"|?*][^/\\:<>"|?*]*$/.test(name) &&
      !hasControlCharacter(name) &&
      hasFileExtension("program", name),
    "Fusion must supply a safe NC file name."
  )

export const FusionProgramSummarySchema = z.strictObject({
  /** For this Fusion session only; `documentId` and `operationId` find the program again later. */
  id: FusionProgramIdSchema,
  name: TextSchema,
  documentName: TextSchema,
  /**
   * The document's lineage id, the same for all its versions; null for a document never saved.
   * Absent from add-ins older than this app.
   */
  documentId: z.string().min(1).max(500).nullable().optional(),
  /** The NC program's id in its document, which saving and reloading keep; absent as above. */
  operationId: z.int().nonnegative().nullable().optional(),
})
export type FusionProgramSummary = z.infer<typeof FusionProgramSummarySchema>

export const FusionProgramsSchema = z
  .array(FusionProgramSummarySchema)
  .max(FUSION_MAX_PROGRAMS)
  .refine(
    (programs) =>
      new Set(programs.map(({ id }) => id)).size === programs.length,
    "Fusion returned duplicate program identifiers."
  )

export const FusionProgramListSchema = z.strictObject({
  programs: FusionProgramsSchema,
})

export const FusionProgramSchema = FusionProgramSummarySchema.extend({
  fileName: FusionFileNameSchema,
  contents: NcSchema.refine(
    (contents) =>
      contents.trim().length > 0 && !/[\uD800-\uDFFF]/u.test(contents),
    "The Fusion NC program must contain valid UTF-8 text."
  ),
})
export type FusionProgram = z.infer<typeof FusionProgramSchema>

/** Local Fusion access; pairing credentials never appear in results or persisted settings. */
export const fusionMethods = {
  "fusion.snapshot": {
    params: z.undefined(),
    result: FusionConnectionSnapshotSchema,
  },
  "fusion.pair": {
    params: z.strictObject({ requestId: z.uuid(), code: FusionOtpSchema }),
    result: z.void(),
    timeoutMs: 15_000,
  },
  "fusion.dismissPairing": {
    params: z.strictObject({ requestId: z.uuid() }),
    result: z.void(),
  },
  "fusion.list": {
    params: z.undefined(),
    result: FusionProgramsSchema,
    timeoutMs: 15_000,
  },
  "fusion.read": {
    params: z.strictObject({ id: FusionProgramIdSchema }),
    result: FusionProgramSchema,
    timeoutMs: 130_000,
  },
  "fusion.disconnect": {
    params: z.undefined(),
    result: z.void(),
  },
} as const

export const fusionEvents = {
  "fusion.changed": {
    params: z.undefined(),
    data: FusionConnectionSnapshotSchema,
  },
} as const
