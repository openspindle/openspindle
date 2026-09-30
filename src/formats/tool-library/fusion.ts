import {
  ToolShapeSchema,
  clone,
  createPreset,
  createTool,
  defaultProbeProfile,
  isJson,
  issueMessages,
  record,
  uniqueId,
} from "@/domain/tools/tool"
import type {
  Tool,
  ToolHolder,
  ToolSegment,
  ToolShaft,
} from "@/domain/tools/tool"

/*
 * Fusion 360's tool library JSON as a Tool: the geometry, holder, shaft and cutting presets
 * Fusion exports, converted to millimetres and degrees. `fusionTool` is also how a stored
 * tool's Fusion record is read again, both to upgrade older tool records (src/formats/
 * tool-library/upgrade.ts) and to compare a saved catalog copy to its catalog original.
 */

/** A ToolSchema issue as `shapeErrors` reports it: structural problems only. */
export function shapeErrors(value: unknown): string[] {
  const result = ToolShapeSchema.safeParse(value)
  return result.success ? [] : issueMessages(result.error)
}

export const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 4096

export function optionalText(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string") throw new Error(`${field} must be text.`)
  return value.trim() || null
}
function optionalNumber(
  value: unknown,
  field: string,
  scale = 1
): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${field} must be a finite number.`)
  // Converting inches leaves float noise (3/8″ is 9.524999999999999 mm); a nanometre is plenty.
  return scale === 1 ? value : Math.round(value * scale * 1e6) / 1e6
}
function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value !== "boolean")
    throw new Error(`${field} must be true or false.`)
  return value
}
function unitScale(unit: unknown): number {
  if (unit === "millimeters") return 1
  if (unit === "inches") return 25.4
  throw new Error("Fusion tool unit must be millimeters or inches.")
}
function objectOrEmpty(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (!record(value)) throw new Error(`${field} must be an object.`)
  return value
}

/** A Fusion holder's or shaft's `segments` ("holder" or "shaft" names it in messages). */
function importSegments(
  value: Record<string, unknown>,
  part: "holder" | "shaft",
  scale: number
): ToolSegment[] {
  if (value.segments !== undefined && !Array.isArray(value.segments))
    throw new Error(`${part}.segments must be an array.`)
  return ((value.segments ?? []) as unknown[]).map((segment) => {
    if (!record(segment)) throw new Error(`${part} segment must be an object.`)
    return {
      height: optionalNumber(segment.height, "segment.height", scale),
      upperDiameter: optionalNumber(
        segment["upper-diameter"],
        "segment.upper-diameter",
        scale
      ),
      lowerDiameter: optionalNumber(
        segment["lower-diameter"],
        "segment.lower-diameter",
        scale
      ),
    }
  })
}

function importHolder(value: unknown, toolScale: number): ToolHolder | null {
  if (value === undefined || value === null) return null
  if (!record(value)) throw new Error("holder must be an object.")
  const scale = value.unit === undefined ? toolScale : unitScale(value.unit)
  return {
    name: optionalText(value.description, "holder.description"),
    vendor: optionalText(value.vendor, "holder.vendor"),
    productId: optionalText(value["product-id"], "holder.product-id"),
    productLink: optionalText(value["product-link"], "holder.product-link"),
    gaugeLength: optionalNumber(value.gaugeLength, "holder.gaugeLength", scale),
    segments: importSegments(value, "holder", scale),
  }
}

function importShaft(value: unknown, toolScale: number): ToolShaft {
  if (value === undefined || value === null) return { segments: [] }
  if (!record(value)) throw new Error("shaft must be an object.")
  const scale = value.unit === undefined ? toolScale : unitScale(value.unit)
  return { segments: importSegments(value, "shaft", scale) }
}

/** Fusion's tapered type ("tapered_bull_nose") as the tip it gives ("bull nose"). */
function taperedTip(value: unknown): string | null {
  const type = optionalText(value, "tapered-type")
  if (type === null) return null
  return (
    type
      .replace(/^tapered[_\s-]*/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || null
  )
}

/**
 * A preset's stock material: its text, or a Fusion material's query or category, where the
 * category "all" names none.
 */
function presetMaterial(value: unknown): string | null {
  if (typeof value === "string") return value
  if (!record(value)) return null
  const query = typeof value.query === "string" ? value.query.trim() : ""
  if (query) return query
  const category =
    typeof value.category === "string" ? value.category.trim() : ""
  return category && category.toLowerCase() !== "all" ? category : null
}

const FEET = 0.3048
const GEOMETRY_LENGTHS = [
  "shankDiameter",
  "fluteLength",
  "overallLength",
  "bodyLength",
  "shoulderLength",
  "shoulderDiameter",
  "tipDiameter",
  "tipLength",
  "cornerRadius",
  "assemblyGaugeLength",
  "threadPitchMin",
  "threadPitchMax",
  "maxDiameter",
  "upperRadius",
] as const

/** What a tool's Fusion record imports as today, or null without a readable one. */
export function fusionTool(
  raw: Record<string, unknown>,
  fileName: string,
  index: number
): Tool {
  if (!nonempty(raw.type))
    throw new Error(`Tool ${index + 1} has no Fusion type.`)
  if (!isJson(raw))
    throw new Error(`Tool ${index + 1} contains invalid JSON values.`)
  const scale = unitScale(raw.unit)
  const tool = createTool()
  tool.id = optionalText(raw.guid, "guid") ?? `imported-tool-${index + 1}`
  tool.kind = raw.type
  // Fusion does not say what a probe senses: it gets the profile any probe starts with.
  tool.probe = defaultProbeProfile(raw.type)
  tool.name =
    optionalText(raw.description, "description") ??
    optionalText(raw["product-id"], "product-id") ??
    `${raw.type} ${index + 1}`
  tool.vendor = optionalText(raw.vendor, "vendor")
  tool.productId = optionalText(raw["product-id"], "product-id")
  tool.productLink = optionalText(raw["product-link"], "product-link")
  tool.vendorDescription = optionalText(
    raw["vendor-description"],
    "vendor-description"
  )
  tool.material = optionalText(raw.BMC, "BMC")
  tool.grade = optionalText(raw.GRADE, "GRADE")
  tool.coating = optionalText(raw.coating, "coating")
  tool.notes = optionalText(raw.notes, "notes")
  const geometry = objectOrEmpty(raw.geometry, "geometry")
  tool.diameter = optionalNumber(geometry.DC, "geometry.DC", scale)
  tool.flutes = optionalNumber(geometry.NOF, "geometry.NOF")
  const lengthMap = {
    shankDiameter: "SFDM",
    fluteLength: "LCF",
    overallLength: "OAL",
    bodyLength: "LB",
    shoulderLength: "shoulder-length",
    shoulderDiameter: "shoulder-diameter",
    tipDiameter: "tip-diameter",
    tipLength: "tip-length",
    cornerRadius: "RE",
    assemblyGaugeLength: "assemblyGaugeLength",
    threadPitchMin: "TPN",
    threadPitchMax: "TPX",
    maxDiameter: "DCX",
    upperRadius: "upper-radius",
  } as const
  for (const field of GEOMETRY_LENGTHS)
    tool.geometry[field] = optionalNumber(
      geometry[lengthMap[field]],
      `geometry.${lengthMap[field]}`,
      scale
    )
  tool.geometry.pointAngle = optionalNumber(geometry.SIG, "geometry.SIG")
  tool.geometry.taperAngle = optionalNumber(geometry.TA, "geometry.TA")
  tool.geometry.threadProfileAngle = optionalNumber(
    geometry["thread-profile-angle"],
    "geometry.thread-profile-angle"
  )
  tool.geometry.numberOfTeeth = optionalNumber(geometry.NT, "geometry.NT")
  const handedness = optionalBoolean(geometry.HAND, "geometry.HAND")
  if (handedness === null) tool.geometry.handedness = null
  else tool.geometry.handedness = handedness ? "right" : "left"
  tool.geometry.taperedTip = taperedTip(raw["tapered-type"])
  tool.geometry.threadTip = optionalText(
    geometry["thread-tip-type"],
    "geometry.thread-tip-type"
  )
  tool.geometry.coolantThrough = optionalBoolean(geometry.CSP, "geometry.CSP")
  tool.holder = importHolder(raw.type === "holder" ? raw : raw.holder, scale)
  tool.shaft = importShaft(raw.shaft, scale)
  const post = objectOrEmpty(raw["post-process"], "post-process")
  tool.postProcess = {
    number: optionalNumber(post.number, "post-process.number"),
    diameterOffset: optionalNumber(
      post["diameter-offset"],
      "post-process.diameter-offset"
    ),
    lengthOffset: optionalNumber(
      post["length-offset"],
      "post-process.length-offset"
    ),
    turret: optionalNumber(post.turret, "post-process.turret"),
    manualToolChange: optionalBoolean(
      post["manual-tool-change"],
      "post-process.manual-tool-change"
    ),
    breakControl: optionalBoolean(
      post["break-control"],
      "post-process.break-control"
    ),
    liveTool: optionalBoolean(post.live, "post-process.live"),
    comment: optionalText(post.comment, "post-process.comment"),
  }
  const start = objectOrEmpty(raw["start-values"], "start-values")
  if (start.presets !== undefined && !Array.isArray(start.presets))
    throw new Error("start-values.presets must be an array.")
  const presetIds = new Set<string>()
  tool.presets = ((start.presets ?? []) as unknown[]).map(
    (value, presetIndex) => {
      if (!record(value)) throw new Error("A Fusion preset must be an object.")
      const preset = createPreset()
      preset.id = uniqueId(
        optionalText(value.guid, "preset.guid") ?? `preset-${presetIndex + 1}`,
        presetIds
      )
      preset.name =
        optionalText(value.name, "preset.name") ?? `Preset ${presetIndex + 1}`
      preset.material = presetMaterial(value.material)
      preset.description = optionalText(value.description, "preset.description")
      preset.rpm = optionalNumber(value.n, "preset.n")
      preset.rampRpm = optionalNumber(value.n_ramp, "preset.n_ramp")
      // Fusion gives surface speed in metres per minute, or feet per minute for inch tools.
      preset.cuttingSpeed = optionalNumber(
        value.v_c,
        "preset.v_c",
        raw.unit === "inches" ? FEET : 1
      )
      preset.rampAngle = optionalNumber(
        value["ramp-angle"],
        "preset.ramp-angle"
      )
      const fields = {
        feedRate: "v_f",
        plungeFeed: "v_f_plunge",
        rampFeed: "v_f_ramp",
        leadInFeed: "v_f_leadIn",
        leadOutFeed: "v_f_leadOut",
        transitionFeed: "v_f_transition",
        retractFeed: "v_f_retract",
        feedPerTooth: "f_z",
        feedPerRevolution: "f_n",
        stepover: "stepover",
        stepdown: "stepdown",
      } as const
      for (const [field, source] of Object.entries(fields))
        preset[field as keyof typeof fields] = optionalNumber(
          value[source],
          `preset.${source}`,
          scale
        )
      preset.useStepover = optionalBoolean(
        value["use-stepover"],
        "preset.use-stepover"
      )
      preset.useStepdown = optionalBoolean(
        value["use-stepdown"],
        "preset.use-stepdown"
      )
      preset.coolant = optionalText(
        value["tool-coolant"],
        "preset.tool-coolant"
      )
      preset.useFeedPerRevolution = optionalBoolean(
        value["use-feed-per-revolution"],
        "preset.use-feed-per-revolution"
      )
      return preset
    }
  )
  tool.source = {
    format: "fusion",
    fileName,
    unit: raw.unit as "millimeters" | "inches",
    raw: clone(raw),
  }
  const errors = shapeErrors(tool)
  if (errors.length) throw new Error(`${tool.name}: ${errors[0]}`)
  return tool
}
