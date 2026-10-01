import { z } from "zod"
import { utf8ByteLength } from "@/machine/contract"
import { GridParamsSchema } from "../probing/tasks/grid/params"
import { OutlineParamsSchema } from "../probing/tasks/outline/params"
import { TouchOffParamsSchema } from "../probing/tasks/touch-off/params"
import { OriginParamsSchema } from "../probing/tasks/origin/params"
import {
  PCBOperationDataSchema,
  OPERATION_DATA_BYTES,
} from "../pcb/operation-data"
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
  /** Retains the phase of NC imported from an earlier project format. */
  phase: PhaseSchema.optional(),
})

/** PCB source and recipe; `nc` is null until its toolpath is generated. */
export const PcbSourceSchema = z.object({
  kind: z.literal("pcb"),
  data: PCBOperationDataSchema.refine(
    (data) => utf8ByteLength(JSON.stringify(data)) <= OPERATION_DATA_BYTES,
    "The PCB source exceeds the 8 MiB limit."
  ),
  nc: NcSchema.nullable(),
})

/** An older source without generated NC, kept intact so saving never loses its data. */
export const UnsupportedSourceSchema = z.object({
  kind: z.literal("unsupported"),
  data: z.json(),
  phase: PhaseSchema,
})

/**
 * A probing strategy's id: a generic strategy's is plain ("surface-touch"), a machine's is
 * prefixed with the machine ("makera-z1/height-map").
 */
export const StrategyIdSchema = z
  .string()
  .max(200)
  .regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/, "Unsupported probing strategy.")

/** A probing operation doing `task` with its parameters, `params`. */
const probingSource = <TTask extends string, TParams extends z.ZodType>(
  task: TTask,
  params: TParams
) =>
  z.object({
    kind: z.literal("probing"),
    task: z.literal(task),
    /** The strategy that writes its NC, found among the plate's machine's when compiling. */
    strategy: StrategyIdSchema,
    /** The T number its NC selects the probe by, which its tool binding maps into the plate's table. */
    probe: ToolNumberSchema,
    params,
  })

/**
 * Built-in probing: a probe tool and a strategy that writes the NC from these parameters when
 * compiling. What the operation does, its `task`, decides the parameters: a height grid, a
 * touch-off that sets work Z, an outline traced with a pointer, or a work origin found with a 3D
 * probe.
 */
export const ProbingSourceSchema = z.discriminatedUnion("task", [
  probingSource("grid", GridParamsSchema),
  probingSource("touch-off", TouchOffParamsSchema),
  probingSource("outline", OutlineParamsSchema),
  probingSource("origin", OriginParamsSchema),
])
export type ProbingSource = z.infer<typeof ProbingSourceSchema>
export type ProbingSourceOf<TTask extends ProbingSource["task"]> = Extract<
  ProbingSource,
  { task: TTask }
>

export const OperationSourceSchema = z.discriminatedUnion("kind", [
  FileSourceSchema,
  PcbSourceSchema,
  UnsupportedSourceSchema,
  ProbingSourceSchema,
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
  /** Increments on every change; editors save against the revision they read. */
  revision: z.int().nonnegative(),
  /** Pause the program before this operation (a program stop the dialect maps). */
  stopBefore: z.boolean(),
  tools: z.array(BindingSchema).max(100),
  source: OperationSourceSchema,
})
export type Operation = z.infer<typeof OperationSchema>

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

/** Every change goes through this so editors can detect conflicting saves. */
export const revise = (
  operation: Operation,
  patch: Partial<Omit<Operation, "id" | "revision">>
): Operation => ({
  ...operation,
  ...patch,
  revision: operation.revision + 1,
})
