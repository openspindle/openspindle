import { z } from "zod"

/*
 * The tool model: a library tool's schema, its derived types, and the pure operations on it
 * (validation, factories, comparison keys). Reading and writing tools in a file format —
 * Fusion 360's JSON, the native library JSON, and the zip archive that carries a library's
 * photos and 3D models alongside it — lives in src/formats/tool-library/, which imports this
 * model; this module never imports a file format.
 */

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

/**
 * A tool record's version. Version 2 records (without the shaft, photo, vendor description,
 * grade, the geometry, preset and holder fields version 3 added), version 3 records (without
 * the 3D model) and version 4 records (without the probe profile) are upgraded when read
 * (src/formats/tool-library/upgrade.ts).
 */
export const TOOL_SCHEMA_VERSION = 5

/** The most tools a library may hold; src/formats/tool-library adds its own file size limits. */
export const TOOL_COUNT_LIMIT = 10_000

export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function isJson(value: unknown, depth = 0): value is JsonValue {
  if (depth > 50) return false
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value))
    return value.every((item) => isJson(item, depth + 1))
  return (
    record(value) &&
    Object.values(value).every((item) => isJson(item, depth + 1))
  )
}
const isJsonObject = (value: unknown): value is JsonObject =>
  record(value) && isJson(value)

/*
 * Issue messages are predicates ("must be …", "exceeds …"). toolIssueMessage
 * prefixes the field path, giving the library's historic messages such as
 * "geometry.cornerRadius exceeds half the cutting diameter.".
 */
const TEXT_LIMIT = 4096
const REQUIRED_TEXT = "must be a non-empty string."
const OPTIONAL_TEXT = "must be text or unknown."
const UNSUPPORTED = "is unsupported."

const RequiredText = z
  .string(REQUIRED_TEXT)
  .max(TEXT_LIMIT, REQUIRED_TEXT)
  .regex(/\S/, REQUIRED_TEXT)
const OptionalText = z
  .string(OPTIONAL_TEXT)
  .max(TEXT_LIMIT, OPTIONAL_TEXT)
  .nullable()

/** A finite number within [min, max], or null for an unknown value. */
function measure(max: number, min = 0) {
  const rule = `must be a number from ${min} to ${max}, or unknown.`
  return z.number(rule).min(min, rule).max(max, rule).nullable()
}
/** An integer within [min, max], or null for an unknown value. */
function count(max: number, min = 0) {
  const rule = `must be an integer from ${min} to ${max}, or unknown.`
  return z.int(rule).min(min, rule).max(max, rule).nullable()
}
const Length = measure(100_000)
const Angle = measure(180)
const Speed = measure(1_000_000)
const Feed = measure(10_000_000)
const Register = count(999_999)
const Flag = z.boolean("must be true, false, or unknown.").nullable()

/** Millimetres and degrees; structure only, so vendor data may be inconsistent. */
export const ToolGeometrySchema = z.object(
  {
    shankDiameter: Length,
    fluteLength: Length,
    overallLength: Length,
    bodyLength: Length,
    shoulderLength: Length,
    shoulderDiameter: Length,
    tipDiameter: Length,
    tipLength: Length,
    pointAngle: Angle,
    /** Resolved Fusion TA is retained unchanged; some engraving libraries use a half-angle. */
    taperAngle: Angle,
    cornerRadius: Length,
    assemblyGaugeLength: Length,
    numberOfTeeth: count(1000),
    threadPitchMin: Length,
    threadPitchMax: Length,
    threadProfileAngle: Angle,
    handedness: z
      .enum(["right", "left"], "must be right, left, or unknown.")
      .nullable(),
    /** The largest cutting diameter (Fusion's DCX), as of a face mill wider above its tip. */
    maxDiameter: Length,
    /** A face mill's upper radius. */
    upperRadius: Length,
    /** A tapered mill's tip: flat, ball or bull nose. */
    taperedTip: OptionalText,
    /** A thread mill's tip, such as point. */
    threadTip: OptionalText,
    /** Coolant runs through the tool (Fusion's CSP, the ISO 13399 coolant supply property). */
    coolantThrough: Flag,
  },
  "must be an object."
)

export const CuttingPresetSchema = z.object(
  {
    id: RequiredText,
    name: RequiredText,
    material: OptionalText,
    rpm: Speed,
    rampRpm: Speed,
    feedRate: Feed,
    plungeFeed: Feed,
    rampFeed: Feed,
    leadInFeed: Feed,
    leadOutFeed: Feed,
    feedPerTooth: Feed,
    feedPerRevolution: Feed,
    stepover: Feed,
    stepdown: Feed,
    useStepover: Flag,
    useStepdown: Flag,
    coolant: OptionalText,
    description: OptionalText,
    /** Surface speed in metres per minute. */
    cuttingSpeed: Speed,
    /** Degrees. */
    rampAngle: Angle,
    transitionFeed: Feed,
    retractFeed: Feed,
    useFeedPerRevolution: Flag,
  },
  "must be an object."
)

const PRESET_LIST = "must be an array of at most 1000 entries."
const CuttingPresetListSchema = z
  .array(CuttingPresetSchema, PRESET_LIST)
  .max(1000, PRESET_LIST)
  .superRefine((presets, context) => {
    const ids = new Set<string>()
    presets.forEach((preset, index) => {
      if (ids.has(preset.id))
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "must be unique.",
        })
      ids.add(preset.id)
    })
  })

const SEGMENT_LIST = "must contain at most 1000 entries."
/** Solids of revolution stacked from the bottom up: a height and the diameters at both ends. */
const SegmentListSchema = z
  .array(
    z.object(
      { height: Length, upperDiameter: Length, lowerDiameter: Length },
      "must be an object."
    ),
    SEGMENT_LIST
  )
  .max(1000, SEGMENT_LIST)

export const ToolHolderSchema = z.object(
  {
    name: OptionalText,
    vendor: OptionalText,
    productId: OptionalText,
    productLink: OptionalText,
    gaugeLength: Length,
    segments: SegmentListSchema,
  },
  "must be an object or unknown."
)

/**
 * The shaft's profile from the shoulder up (Fusion 360's Shaft tab), such as the taper from
 * the flutes to the shank; without segments the shank begins at the shoulder.
 */
export const ToolShaftSchema = z.object(
  { segments: SegmentListSchema },
  "must be an object."
)

export const ToolPostProcessSchema = z.object(
  {
    number: Register,
    diameterOffset: Register,
    lengthOffset: Register,
    turret: Register,
    manualToolChange: Flag,
    breakControl: Flag,
    liveTool: Flag,
    comment: OptionalText,
  },
  "must be an object."
)

/** A picture the app bundles ("/images/…"). */
export const BUNDLED_IMAGE = /^\/images\/[\w.-]+$/
const IMAGE =
  "must be a bundled image or a PNG, JPEG or WebP data URL, or unknown."
/** A chosen photo is kept in the tool as a data URL of at most this many characters. */
export const TOOL_IMAGE_LIMIT = 400_000
const ImageSchema = z
  .string(IMAGE)
  .max(TOOL_IMAGE_LIMIT, IMAGE)
  .refine(
    (image) =>
      BUNDLED_IMAGE.test(image) ||
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image),
    IMAGE
  )
  .nullable()

/** A 3D model the app bundles ("/models/….glb"). */
export const BUNDLED_TOOL_MODEL = /^\/models\/[\w.-]+\.glb$/
const MODEL = "must be a bundled model or a binary glTF data URL, or unknown."
/** A chosen 3D model (binary glTF) is kept in the tool; it may be this large. */
export const TOOL_MODEL_BYTES = 1024 * 1024
/** Its data URL, of at most this many characters. */
const TOOL_MODEL_LIMIT =
  "data:model/gltf-binary;base64,".length + 4 * Math.ceil(TOOL_MODEL_BYTES / 3)
const ModelSchema = z
  .string(MODEL)
  .max(TOOL_MODEL_LIMIT, MODEL)
  .refine(
    (model) =>
      BUNDLED_TOOL_MODEL.test(model) ||
      /^data:model\/gltf-binary;base64,[A-Za-z0-9+/]+={0,2}$/.test(model),
    MODEL
  )
  .nullable()

/** What a probe senses and carries, which decides the probing it can do. */
export const ProbeProfileSchema = z.object(
  {
    /** What the stylus senses: touches along Z only, or in X, Y and Z (a 3D touch probe). */
    touch: z.enum(["z", "xyz"], "must be z or xyz."),
    /** Whether it carries a laser pointer, which traces without touching. */
    pointer: z.boolean("must be true or false."),
  },
  "must be an object or unknown."
)
export type ProbeProfile = z.infer<typeof ProbeProfileSchema>

/**
 * The record a tool was imported from, kept as provenance in its original units: the app
 * reads nothing from it but the upgrade of tools stored by earlier versions. Never evaluate
 * its expressions.
 */
export const ToolSourceSchema = z.object(
  {
    format: z.enum(["fusion", "native"], UNSUPPORTED),
    fileName: OptionalText,
    unit: z.enum(["millimeters", "inches"], UNSUPPORTED).nullable(),
    raw: z
      .custom<JsonObject>(isJsonObject, "must be a JSON object or unknown.")
      .nullable(),
  },
  "must be an object or unknown."
)

/**
 * The structure of a stored tool. Structural validation deliberately preserves
 * physically inconsistent vendor data; ToolSchema adds the physical rules.
 * Unknown keys are accepted, as they always were, so stored tools stay valid.
 */
export const ToolShapeSchema = z.object(
  {
    schemaVersion: z.literal(TOOL_SCHEMA_VERSION, UNSUPPORTED),
    id: RequiredText,
    name: RequiredText,
    kind: RequiredText,
    diameter: measure(1000, 0.000001),
    flutes: count(100, 1),
    /** A probe's profile, which only a probe may have; null for a probe of unknown profile. */
    probe: ProbeProfileSchema.nullable(),
    vendor: OptionalText,
    productId: OptionalText,
    productLink: OptionalText,
    /** The vendor's own text for the tool, such as its catalog title. */
    vendorDescription: OptionalText,
    material: OptionalText,
    /** The tool material's grade. */
    grade: OptionalText,
    coating: OptionalText,
    notes: OptionalText,
    /** A product photo. */
    image: ImageSchema,
    /**
     * A 3D model the tool is drawn with instead of its dimensions: binary glTF (metres, Y up)
     * with the tip at the origin and the axis along +Y.
     */
    model: ModelSchema,
    geometry: ToolGeometrySchema,
    holder: ToolHolderSchema.nullable(),
    shaft: ToolShaftSchema,
    presets: CuttingPresetListSchema,
    postProcess: ToolPostProcessSchema,
    source: ToolSourceSchema.nullable(),
  },
  "must be an object."
)

export type ToolGeometry = z.infer<typeof ToolGeometrySchema>
export type CuttingPreset = z.infer<typeof CuttingPresetSchema>
export type ToolHolder = z.infer<typeof ToolHolderSchema>
export type ToolShaft = z.infer<typeof ToolShaftSchema>
/** A holder or shaft segment. */
export type ToolSegment = ToolShaft["segments"][number]
export type ToolPostProcess = z.infer<typeof ToolPostProcessSchema>
export type ToolSource = z.infer<typeof ToolSourceSchema>

const GEOMETRY_TOLERANCE = 0.00001
const exceeds = (value: number | null, limit: number | null) =>
  value !== null && limit !== null && value > limit + GEOMETRY_TOLERANCE

/** Physical consistency of a tool's dimensions. */
function checkGeometry(
  tool: { kind: string; diameter: number | null; geometry: ToolGeometry },
  context: z.RefinementCtx
) {
  const { geometry } = tool
  const report = (field: keyof ToolGeometry, message: string) =>
    context.addIssue({ code: "custom", path: ["geometry", field], message })
  for (const field of ["fluteLength", "bodyLength", "shoulderLength"] as const)
    if (exceeds(geometry[field], geometry.overallLength))
      report(field, "exceeds overallLength.")
  if (exceeds(geometry.tipDiameter, tool.diameter))
    report("tipDiameter", "exceeds the cutting diameter.")
  // A radius mill's corner is concave, rounding over outside its tip diameter, so its
  // radius may exceed half of it (a round-over bit: an 8 mm radius on a 0.7 mm tip).
  const halfDiameter = tool.diameter === null ? null : tool.diameter / 2
  if (
    toolKindKey(tool.kind) !== "radius mill" &&
    exceeds(geometry.cornerRadius, halfDiameter)
  )
    report("cornerRadius", "exceeds half the cutting diameter.")
  if (exceeds(geometry.threadPitchMin, geometry.threadPitchMax))
    report("threadPitchMin", "exceeds threadPitchMax.")
}
/** Only a probe has a probe profile; a probe may lack one. */
function checkProbe(
  tool: { kind: string; probe: ProbeProfile | null },
  context: z.RefinementCtx
) {
  if (tool.probe !== null && !isProbe(tool))
    context.addIssue({
      code: "custom",
      path: ["probe"],
      message: "must be unknown unless the tool is a probe.",
    })
}
/** The physical rules: consistent dimensions, and a probe profile only on a probe. */
function checkPhysics(
  tool: {
    kind: string
    diameter: number | null
    geometry: ToolGeometry
    probe: ProbeProfile | null
  },
  context: z.RefinementCtx
) {
  checkGeometry(tool, context)
  checkProbe(tool, context)
}
/** Physical rules only judge a structurally valid tool. */
const PHYSICAL_RULES = {
  when: (payload: { issues: readonly unknown[] }) =>
    payload.issues.length === 0,
}

/** A tool with every rule a saved tool must meet: structure, limits, geometry and profile. */
export const ToolSchema = ToolShapeSchema.superRefine(
  checkPhysics,
  PHYSICAL_RULES
)
export type Tool = z.infer<typeof ToolSchema>

/** The editable part of a tool: everything but its read-only import source. */
export const ToolDraftSchema = ToolShapeSchema.omit({
  source: true,
}).superRefine(checkPhysics, PHYSICAL_RULES)
export type ToolDraft = z.infer<typeof ToolDraftSchema>

export function toToolDraft({ source: _source, ...draft }: Tool): ToolDraft {
  return draft
}

/** A ToolSchema issue as Zod or any Standard Schema consumer reports it. */
export interface ToolIssue {
  readonly message: string
  readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[]
}

/** "geometry.cornerRadius exceeds …", "presets[0].rpm must be …", "Tool must be …". */
export function toolIssueMessage(issue: ToolIssue): string {
  let subject = ""
  for (const segment of issue.path ?? []) {
    const key = typeof segment === "object" ? segment.key : segment
    if (typeof key === "number") subject += `[${key}]`
    else if (subject) subject += `.${String(key)}`
    else subject = String(key)
  }
  return `${subject || "Tool"} ${issue.message}`
}
export const issueMessages = (error: z.ZodError) => [
  ...new Set(error.issues.map(toolIssueMessage)),
]

export const isTool = (value: unknown): value is Tool =>
  ToolShapeSchema.safeParse(value).success

/** A tool type compared loosely: "Bull-Nose_End Mill" and "bull nose end mill" are one type. */
export const toolKindKey = (kind: string) =>
  kind
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .trim()

/** Whether a tool is a probe, its type compared loosely like any other ({@link toolKindKey}). */
export const isProbe = (tool: { readonly kind: string }) =>
  toolKindKey(tool.kind) === "probe"

/**
 * The profile a tool of a type starts with: a probe touches along Z only and carries no
 * pointer, which any touch probe can do; any other tool has none.
 */
export function defaultProbeProfile(kind: string): ProbeProfile | null {
  return isProbe({ kind }) ? { touch: "z", pointer: false } : null
}

/** A probe's profile; null for any other tool, and for a probe of unknown profile. */
export function probeProfile(
  tool: Pick<ToolDraft, "kind" | "probe">
): ProbeProfile | null {
  return isProbe(tool) ? tool.probe : null
}

/** Structural problems if there are any, otherwise physical inconsistencies. */
export function validateTool(value: unknown): string[] {
  const result = ToolSchema.safeParse(value)
  return result.success ? [] : issueMessages(result.error)
}

export function uniqueId(preferred: string, used: Set<string>): string {
  let id = preferred
  let suffix = 2
  while (used.has(id)) id = `${preferred}-${suffix++}`
  used.add(id)
  return id
}

export function createPreset(
  existing: readonly CuttingPreset[] = []
): CuttingPreset {
  return {
    id: uniqueId("preset", new Set(existing.map((preset) => preset.id))),
    name: "Untitled preset",
    material: null,
    rpm: null,
    rampRpm: null,
    feedRate: null,
    plungeFeed: null,
    rampFeed: null,
    leadInFeed: null,
    leadOutFeed: null,
    feedPerTooth: null,
    feedPerRevolution: null,
    stepover: null,
    stepdown: null,
    useStepover: null,
    useStepdown: null,
    coolant: null,
    description: null,
    cuttingSpeed: null,
    rampAngle: null,
    transitionFeed: null,
    retractFeed: null,
    useFeedPerRevolution: null,
  }
}

/** A holder with nothing known about it yet. */
export function createHolder(): ToolHolder {
  return {
    name: null,
    vendor: null,
    productId: null,
    productLink: null,
    gaugeLength: null,
    segments: [],
  }
}

export function createTool(existing: readonly Tool[] = []): Tool {
  return {
    schemaVersion: TOOL_SCHEMA_VERSION,
    id: uniqueId("tool", new Set(existing.map((tool) => tool.id))),
    name: "Untitled tool",
    kind: "flat end mill",
    diameter: null,
    flutes: null,
    probe: null,
    vendor: null,
    productId: null,
    productLink: null,
    vendorDescription: null,
    material: null,
    grade: null,
    coating: null,
    notes: null,
    image: null,
    model: null,
    geometry: {
      shankDiameter: null,
      fluteLength: null,
      overallLength: null,
      bodyLength: null,
      shoulderLength: null,
      shoulderDiameter: null,
      tipDiameter: null,
      tipLength: null,
      pointAngle: null,
      taperAngle: null,
      cornerRadius: null,
      assemblyGaugeLength: null,
      numberOfTeeth: null,
      threadPitchMin: null,
      threadPitchMax: null,
      threadProfileAngle: null,
      handedness: null,
      maxDiameter: null,
      upperRadius: null,
      taperedTip: null,
      threadTip: null,
      coolantThrough: null,
    },
    holder: null,
    shaft: { segments: [] },
    presets: [],
    postProcess: {
      number: null,
      diameterOffset: null,
      lengthOffset: null,
      turret: null,
      manualToolChange: null,
      breakControl: null,
      liveTool: null,
      comment: null,
    },
    source: null,
  }
}

export function duplicateTool(
  tool: Tool,
  existing: readonly Tool[] = []
): Tool {
  const duplicate = clone(tool)
  duplicate.id = uniqueId(
    tool.id,
    new Set([...existing.map((item) => item.id), tool.id])
  )
  duplicate.name = `${tool.name} copy`
  return duplicate
}
