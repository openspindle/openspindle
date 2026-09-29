import { z } from "zod"
import { utf8ByteLength } from "@/machine/contract"
import { AutoLevelParamsSchema } from "../auto-level/params"
import { AutoScanParamsSchema } from "../auto-scan/params"
import { AutoZHeightParamsSchema } from "../auto-z-height/params"
import { Probe3dParamsSchema } from "../probe-3d/params"
import {
  EntityIdSchema,
  TextSchema,
  ToolNumberSchema,
  newId,
  normalizeText,
} from "../primitives"

const MiB = 1024 * 1024
export const OPERATION_LIMITS = {
  operationsPerPlate: 100,
  /** NC text in UTF-8 bytes (`utf8ByteLength`), as it is stored and exchanged. */
  ncBytes: 10 * MiB,
  pluginDataBytes: 8 * MiB,
} as const

/** Control characters other than tab, line feed and carriage return. */
function hasNcControlCharacter(nc: string): boolean {
  for (let index = 0; index < nc.length; index++) {
    const code = nc.charCodeAt(index)
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
      return true
  }
  return false
}

/**
 * NC text as stored: bounded in UTF-8 bytes (the measure storage limits it by), and free of
 * control characters other than whitespace.
 */
export const NcSchema = z
  .string()
  .refine(
    (nc) => utf8ByteLength(nc) <= OPERATION_LIMITS.ncBytes,
    `The NC exceeds the ${OPERATION_LIMITS.ncBytes / MiB} MiB limit.`
  )
  .refine(
    (nc) => !hasNcControlCharacter(nc),
    "NC contains unsupported control characters."
  )

export const PhaseSchema = z.enum(["setup", "machining", "finish"])
export type Phase = z.infer<typeof PhaseSchema>

export const ParameterValuesSchema = z
  .record(z.string().min(1).max(200), z.union([z.number(), z.boolean()]))
  .refine((values) => Object.keys(values).length <= 20, "Too many parameters.")
export type ParameterValues = z.infer<typeof ParameterValuesSchema>

/**
 * Maps a tool number the operation's own NC selects (`local`) to a number in the plate's
 * tool table (`plate`). `null` on both sides is the implicit tool of NC that selects none.
 */
export const BindingSchema = z.object({
  local: ToolNumberSchema.nullable(),
  plate: ToolNumberSchema.nullable(),
})
export type Binding = z.infer<typeof BindingSchema>

/**
 * Where an operation's NC came from, so that it can be brought up to date from there: an NC
 * program in a Fusion 360 document, found again by the document's lineage id and the program's
 * id in it (their names while an id is unknown), and how importing made the operation of it.
 */
export const NcOriginSchema = z.strictObject({
  kind: z.literal("fusion"),
  /** The same for all versions of the document; null while it was never saved. */
  documentId: z.string().min(1).max(500).nullable(),
  documentName: TextSchema,
  /** The NC program's id in its document, which saving and reloading keep. */
  programId: z.int().nonnegative().nullable(),
  programName: TextSchema,
  /** The part of the program the operation is, by the way importing split it; null for all of it. */
  part: z
    .strictObject({ mode: z.enum(["tool", "toolpath"]), name: TextSchema })
    .nullable(),
  /** How each design rule's issue was resolved, by rule, which an update resolves alike. */
  resolutions: z
    .record(
      z.string().regex(/^[a-z0-9-]{1,64}$/),
      z.enum(["ignore", "drop", "replace"])
    )
    .refine(
      (resolutions) => Object.keys(resolutions).length <= 100,
      "Too many resolutions."
    ),
})
export type NcOrigin = z.infer<typeof NcOriginSchema>

export const FileSourceSchema = z.object({
  kind: z.literal("file"),
  nc: NcSchema,
  /**
   * Whether the program's closing park runs: its park after the last move, such as the Z1's
   * G28. Off, the operation contributes its NC without it. Files saved before this setting keep
   * theirs.
   */
  park: z.boolean().default(true),
  /** Where the NC came from, for NC that can be updated from there; absent for a file. */
  origin: NcOriginSchema.optional(),
})

/** A declarative plugin template; `nc` is the last generated program. */
export const TemplateSourceSchema = z.object({
  kind: z.literal("template"),
  pluginId: TextSchema,
  programId: TextSchema,
  version: TextSchema,
  values: ParameterValuesSchema,
  phase: PhaseSchema,
  nc: NcSchema,
})

/** Plugin-owned data; `nc` is null until the plugin generates the program. */
export const PluginSourceSchema = z.object({
  kind: z.literal("plugin"),
  pluginId: TextSchema,
  version: TextSchema,
  data: z.json(),
  phase: PhaseSchema,
  nc: NcSchema.nullable(),
})

/** Built-in auto-level: the probing NC is derived from these parameters when compiling. */
export const AutoLevelSourceSchema = z.object({
  kind: z.literal("auto-level"),
  params: AutoLevelParamsSchema,
})

/** Built-in auto Z-height: the touch-off NC is derived from these parameters when compiling. */
export const AutoZHeightSourceSchema = z.object({
  kind: z.literal("auto-z-height"),
  params: AutoZHeightParamsSchema,
})

/** Built-in auto-scan: traces the plate's toolpath bounds, derived when compiling. */
export const AutoScanSourceSchema = z.object({
  kind: z.literal("auto-scan"),
  params: AutoScanParamsSchema,
})

/** Built-in 3D probing: the routine's NC is derived from these parameters when compiling. */
export const Probe3dSourceSchema = z.object({
  kind: z.literal("probe-3d"),
  params: Probe3dParamsSchema,
})

export const OperationSourceSchema = z.discriminatedUnion("kind", [
  FileSourceSchema,
  TemplateSourceSchema,
  PluginSourceSchema,
  AutoLevelSourceSchema,
  AutoZHeightSourceSchema,
  AutoScanSourceSchema,
  Probe3dSourceSchema,
])
export type OperationSource = z.infer<typeof OperationSourceSchema>
export type SourceKind = OperationSource["kind"]
export type SourceOf<TKind extends SourceKind> = Extract<
  OperationSource,
  { kind: TKind }
>

export const OperationSchema = z.object({
  id: EntityIdSchema,
  name: TextSchema,
  /** Increments on every change; plugins save against the revision they read. */
  revision: z.int().nonnegative(),
  /** Pause the program before this operation (a program stop the dialect maps). */
  stopBefore: z.boolean(),
  tools: z.array(BindingSchema).max(100),
  source: OperationSourceSchema,
})
export type Operation = z.infer<typeof OperationSchema>

/** The plugin an operation comes from, for template and plugin operations. */
export function operationPluginId(operation: Operation): string | null {
  const { source } = operation
  return source.kind === "template" || source.kind === "plugin"
    ? source.pluginId
    : null
}

export function createOperation(
  name: string,
  source: OperationSource,
  overrides: Partial<Pick<Operation, "id" | "stopBefore" | "tools">> = {}
): Operation {
  return {
    id: overrides.id ?? newId(),
    name: normalizeText(name) || "Operation",
    revision: 0,
    stopBefore: overrides.stopBefore ?? false,
    tools: overrides.tools ?? [],
    source,
  }
}

/** Every change goes through this so plugin saves can detect conflicts. */
export const revise = (
  operation: Operation,
  patch: Partial<Omit<Operation, "id" | "revision">>
): Operation => ({
  ...operation,
  ...patch,
  revision: operation.revision + 1,
})
