import { z } from "zod"
import { utf8ByteLength } from "../../../src/machine/contract/index.ts"
import { CapabilitySchema } from "./capabilities.ts"
import { PluginIdSchema, VersionSchema, ViewSlotSchema } from "./manifest.ts"
import { PATH_EXTENSIONS } from "./paths.ts"
import type { Sha256 } from "./installer/hash.ts"
import {
  Sha256Schema,
  hasProgramControlCharacter,
  pluginTextBytes,
} from "./text.ts"

/**
 * The data plugins exchange with the host. Parameters are strict (reject what the host
 * does not understand); results are open objects so older SDKs tolerate newer hosts.
 */

export const OPERATION_LIMITS = {
  dataBytes: 8 * 1024 * 1024,
  ncBytes: 10 * 1024 * 1024,
  create: 50,
} as const

const IdSchema = z.string().min(1).max(200)
export const PlateIdSchema = IdSchema
export const OperationIdSchema = IdSchema
export const ToolIdSchema = IdSchema
export const RevisionSchema = Sha256Schema

export const JsonSchema = z.json()
export type JsonValue = z.infer<typeof JsonSchema>

/** Plugin-owned JSON, opaque to the host and bounded in size. */
export const OperationDataSchema = JsonSchema.refine(
  (data) => pluginTextBytes(JSON.stringify(data)) <= OPERATION_LIMITS.dataBytes,
  "Operation data exceeds 8 MiB."
)

/**
 * Generated NC text; importing or saving it never runs it. Bounded in UTF-8 bytes, the
 * measure the host stores NC with.
 */
export const ProgramTextSchema = z
  .string()
  .refine(
    (text) => utf8ByteLength(text) <= OPERATION_LIMITS.ncBytes,
    "NC programs are limited to 10 MiB."
  )
  .refine(
    (text) => !hasProgramControlCharacter(text),
    "NC programs cannot contain control characters."
  )

export const OperationNameSchema = z
  .string()
  .trim()
  .min(1, "Enter an operation name.")
  .max(180, "Operation names are at most 180 characters.")

/** `default` or a tool number as written in the NC program. */
export const ToolSlotSchema = z
  .string()
  .regex(
    /^(?:default|0|[1-9]\d{0,5})$/,
    "Tool slots are default or a tool number."
  )

/** An operation this plugin owns, as it last saved it. */
export const OperationSchema = z.object({
  id: OperationIdSchema,
  plateId: PlateIdSchema,
  name: z.string(),
  /** Content hash; saving with an older revision fails with CONFLICT. */
  revision: RevisionSchema,
  stopBefore: z.boolean(),
  /** Which library tool each tool slot of `nc` uses. */
  toolAssignments: z.record(ToolSlotSchema, ToolIdSchema),
  data: JsonSchema,
  /** Null while the operation awaits generation; such operations block Run. */
  nc: z.string().nullable(),
})
export type Operation = z.infer<typeof OperationSchema>

export const OperationDraftSchema = z.strictObject({
  name: OperationNameSchema,
  stopBefore: z.boolean().default(false),
  toolAssignments: z.record(ToolSlotSchema, ToolIdSchema).default({}),
  data: OperationDataSchema,
  nc: ProgramTextSchema.nullable(),
})
export type OperationDraft = z.input<typeof OperationDraftSchema>

export const OperationPatchSchema = z.strictObject({
  id: OperationIdSchema,
  revision: RevisionSchema,
  name: OperationNameSchema.optional(),
  stopBefore: z.boolean().optional(),
  toolAssignments: z.record(ToolSlotSchema, ToolIdSchema).optional(),
  data: OperationDataSchema.optional(),
  nc: ProgramTextSchema.nullable().optional(),
})
export type OperationPatch = z.input<typeof OperationPatchSchema>

export const StockSchema = z.object({
  name: z.string(),
  material: z.string().nullable(),
  width: z.number(),
  depth: z.number(),
  height: z.number(),
})

export const PlateSummarySchema = z.object({
  id: PlateIdSchema,
  /** As the app shows the plate: its name, or "Plate N" by its place while it has none. */
  name: z.string(),
  stock: StockSchema.nullable(),
})
export type PlateSummary = z.infer<typeof PlateSummarySchema>

/** What workspace:read reveals: plates and the selection, never other plugins' data. */
export const WorkspaceSummarySchema = z.object({
  /** Increases with every change; a lower revision is stale. */
  revision: z.int().nonnegative(),
  units: z.literal("mm"),
  plates: z.array(PlateSummarySchema),
  selectedPlateId: PlateIdSchema.nullable(),
})
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>

/** Unknown values are null. Lengths are millimetres, angles degrees, feeds mm/min. */
const reading = z.number().nullable()
const optionalText = z.string().nullable()
const optionalFlag = z.boolean().nullable()

export const CuttingPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  material: optionalText,
  description: optionalText,
  /** Spindle speed and ramp spindle speed in rpm. */
  rpm: reading,
  rampRpm: reading,
  /** Surface speed in metres per minute. */
  cuttingSpeed: reading,
  feedRate: reading,
  plungeFeed: reading,
  rampFeed: reading,
  rampAngle: reading,
  leadInFeed: reading,
  leadOutFeed: reading,
  transitionFeed: reading,
  retractFeed: reading,
  /** Millimetres per tooth and per revolution. */
  feedPerTooth: reading,
  feedPerRevolution: reading,
  useFeedPerRevolution: optionalFlag,
  stepover: reading,
  stepdown: reading,
  useStepover: optionalFlag,
  useStepdown: optionalFlag,
  coolant: optionalText,
})
export type CuttingPreset = z.infer<typeof CuttingPresetSchema>

/**
 * A library tool as plugins see it: identity and vendor data, geometry and shaft, cutting
 * presets, and the app's thumbnail of it. The app keeps its photo, 3D model, holder, other
 * post-processor settings and import source to itself.
 */
export const ToolSchema = z.object({
  id: ToolIdSchema,
  name: z.string(),
  kind: z.string(),
  diameter: reading,
  flutes: reading,
  vendor: optionalText,
  productId: optionalText,
  productLink: optionalText,
  /** The vendor's own text for the tool, such as its catalog title. */
  vendorDescription: optionalText,
  material: optionalText,
  grade: optionalText,
  coating: optionalText,
  notes: optionalText,
  /** The post-processor tool number, when set. */
  number: z.int().nullable(),
  geometry: z.object({
    shankDiameter: reading,
    fluteLength: reading,
    overallLength: reading,
    /** The length below the holder. */
    bodyLength: reading,
    shoulderLength: reading,
    shoulderDiameter: reading,
    tipDiameter: reading,
    tipLength: reading,
    pointAngle: reading,
    taperAngle: reading,
    cornerRadius: reading,
    assemblyGaugeLength: reading,
    numberOfTeeth: reading,
    threadPitchMin: reading,
    threadPitchMax: reading,
    threadProfileAngle: reading,
    handedness: z.enum(["right", "left"]).nullable(),
    /** The largest cutting diameter, as of a face mill wider above its tip. */
    maxDiameter: reading,
    upperRadius: reading,
    /** A tapered mill's tip: flat, ball or bull nose. */
    taperedTip: optionalText,
    /** A thread mill's tip, such as point. */
    threadTip: optionalText,
    /** Coolant runs through the tool. */
    coolantThrough: optionalFlag,
  }),
  /** Segments stacked from the shoulder up, such as the taper from the flutes to the shank. */
  shaft: z.object({
    segments: z.array(
      z.object({
        height: reading,
        upperDiameter: reading,
        lowerDiameter: reading,
      })
    ),
  }),
  presets: z.array(CuttingPresetSchema),
  /**
   * The app's thumbnail of the tool's cutting end, which `ToolCard` shows: a PNG data URL, or
   * null until the app has drawn it.
   */
  picture: z.string().nullable().optional(),
})
export type Tool = z.infer<typeof ToolSchema>

export const ToolChoiceRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(80).optional(),
  selectedToolId: ToolIdSchema.nullable().default(null),
  /**
   * Tool types for the chooser's "Recommended" filter, which it opens on; any tool can
   * still be chosen. Types match ignoring case, dashes and spacing.
   */
  recommendedKinds: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .default([]),
  /**
   * After a tool, ask whether to apply one of its cutting presets. The preset offered
   * first is the chosen tool's entry in `defaultPresetIds`, else
   * `defaultPresetId` when that tool has it.
   */
  presetStep: z
    .strictObject({
      defaultPresetId: z.string().max(200).nullable().default(null),
      defaultPresetIds: z
        .record(ToolIdSchema, z.string().max(200))
        .refine(
          (presets) => Object.keys(presets).length <= 10_000,
          "Name at most 10000 default presets."
        )
        .default({}),
    })
    .nullable()
    .default(null),
})
export type ToolChoiceRequest = z.input<typeof ToolChoiceRequestSchema>

export const ToolChoiceSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("canceled") }),
  z.object({
    status: z.literal("chosen"),
    tool: ToolSchema,
    /** The preset to apply; null keeps the operation's current cutting values. */
    presetId: z.string().nullable(),
  }),
])
export type ToolChoice = z.infer<typeof ToolChoiceSchema>

export const ThemeSchema = z.enum(["light", "dark"])

/** Where and how a view is shown; pushed again whenever it changes. */
export const ViewContextSchema = z.object({
  viewId: z.string(),
  slot: ViewSlotSchema,
  plateId: PlateIdSchema.nullable(),
  /** The operation an operation.editor view edits. */
  operationId: OperationIdSchema.nullable(),
  theme: ThemeSchema,
  /** The workspace is busy (a job or an import); views should not start edits. */
  disabled: z.boolean(),
})
export type ViewContext = z.infer<typeof ViewContextSchema>

export const PluginIdentitySchema = z.object({
  id: PluginIdSchema,
  name: z.string(),
  version: VersionSchema,
  grants: z.array(CapabilitySchema),
  companion: z.boolean(),
})
export type PluginIdentity = z.infer<typeof PluginIdentitySchema>

/** Everything a frame needs to start: who it is, what to render, and the code. */
export const FrameBootSchema = z.object({
  plugin: PluginIdentitySchema,
  view: z.object({ id: z.string(), slot: ViewSlotSchema, title: z.string() }),
  context: ViewContextSchema,
  bundle: z.object({ script: z.string(), styles: z.string().nullable() }),
})
export type FrameBoot = z.infer<typeof FrameBootSchema>

export const NoticeSchema = z.strictObject({
  message: z.string().trim().min(1).max(500),
  tone: z.enum(["info", "success", "warning", "error"]).default("info"),
})
export type Notice = z.input<typeof NoticeSchema>

export const ProgressSchema = z.strictObject({
  label: z.string().trim().min(1).max(120),
  /** 0 to 1, or null while indeterminate. */
  value: z.number().min(0).max(1).nullable(),
  done: z.boolean().default(false),
})
export type Progress = z.input<typeof ProgressSchema>

export const ConfirmRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000).optional(),
  confirmLabel: z.string().trim().min(1).max(40).optional(),
  cancelLabel: z.string().trim().min(1).max(40).optional(),
  destructive: z.boolean().default(false),
})
export type ConfirmRequest = z.input<typeof ConfirmRequestSchema>

/** Programs a plugin imports are bare file names with a template extension. */
const PROGRAM_FILE_NAME = new RegExp(
  `^[^/\\\\:]+\\.(?:${PATH_EXTENSIONS.template.join("|")})$`,
  "i"
)
const PROGRAM_FILE_TYPES = new Intl.ListFormat("en", {
  type: "disjunction",
}).format(PATH_EXTENSIONS.template.map((extension) => `.${extension}`))

export const ProgramFileSchema = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(200)
    .regex(
      PROGRAM_FILE_NAME,
      `Program files are ${PROGRAM_FILE_TYPES} names without folders.`
    ),
  text: ProgramTextSchema,
})

/**
 * What the user set for a plugin's settings, by setting ID; a setting without a value is
 * absent. An executable is the program's full path.
 */
export const SettingValuesSchema = z.partialRecord(
  z.string().max(64),
  z.string().min(1).max(4096)
)
export type SettingValues = z.infer<typeof SettingValuesSchema>

/** Plugin-defined companion method names. */
export const CompanionMethodSchema = z
  .string()
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_.:-]{0,63}$/,
    "Companion methods are names of at most 64 letters, digits, and . _ : -"
  )

export const CompanionHealthSchema = z.object({
  status: z.enum(["ready", "needs-setup", "degraded"]),
  message: z.string().max(2000).nullable(),
})
export type CompanionHealth = z.infer<typeof CompanionHealthSchema>

export const COMPANION_STATES = [
  "stopped",
  "starting",
  "running",
  "stopping",
  "backoff",
  "failed",
] as const

export const CompanionStatusSchema = z.object({
  state: z.enum(COMPANION_STATES),
  health: CompanionHealthSchema.nullable(),
  /** Whether the companion has a setup step (Run setup); known once it has started. */
  setup: z.boolean(),
  restarts: z.int().nonnegative(),
  lastError: z.string().nullable(),
  /** When the next automatic start is allowed during backoff. */
  retryAt: z.number().nullable(),
})
export type CompanionStatus = z.infer<typeof CompanionStatusSchema>

export const CompanionEmitSchema = z.strictObject({
  name: CompanionMethodSchema,
  payload: JsonSchema,
})
export type CompanionEmit = z.infer<typeof CompanionEmitSchema>

/** Sorted keys: equal JSON values always serialize identically. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

/** The content hash of an operation as the plugin sees it. */
export function operationRevision(
  operation: Omit<Operation, "revision">,
  sha256: Sha256
): Promise<string> {
  const { data, ...fields } = operation
  const text = `${canonicalJson(fields)}\n${canonicalJson(data)}`
  return sha256(new TextEncoder().encode(text))
}
