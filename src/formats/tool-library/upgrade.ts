import {
  BUNDLED_IMAGE,
  TOOL_COUNT_LIMIT,
  TOOL_SCHEMA_VERSION,
  clone,
  createHolder,
  createPreset,
  createTool,
  defaultProbeProfile,
  isTool,
  record,
  uniqueId,
} from "@/domain/tools/tool"
import type { ProbeProfile, Tool } from "@/domain/tools/tool"
import { PROBE_3D_TOOL } from "@/domain/tools/tool-table"
import { fusionTool } from "./fusion"

/*
 * Brings a tool record stored, exported or saved in a project by an earlier version up to
 * date, one schema version at a time. Version 2 records (without the shaft, photo, vendor
 * description, grade, and the geometry, preset and holder fields version 3 added), version 3
 * records (without the 3D model) and version 4 records (without the probe profile) are
 * upgraded when read; anything else passes unchanged.
 */

/** The fields version 3 added, which version 2 records lack. */
const ADDED_TOOL_FIELDS = ["vendorDescription", "grade", "image", "shaft"]
const ADDED_GEOMETRY_FIELDS = [
  "maxDiameter",
  "upperRadius",
  "taperedTip",
  "threadTip",
  "coolantThrough",
]
const ADDED_PRESET_FIELDS = [
  "description",
  "cuttingSpeed",
  "rampAngle",
  "transitionFeed",
  "retractFeed",
  "useFeedPerRevolution",
]
const ADDED_HOLDER_FIELDS = ["productLink"]

/** `keys` of `from`, missing ones as null. */
function picked(from: object | null | undefined, keys: readonly string[]) {
  const entries = (from ?? {}) as Record<string, unknown>
  return Object.fromEntries(keys.map((key) => [key, entries[key] ?? null]))
}

/**
 * `stored` with those of `added` it lacks, keyed in `order`'s order (then any other keys of
 * `stored`), so an upgraded record serializes as a new one does. Keys that `stored` lacks and
 * `added` does not give stay missing, so a damaged record stays damaged.
 */
function withKeys(
  order: object,
  stored: Record<string, unknown>,
  added: Record<string, unknown>
): Record<string, unknown> {
  const entries: [string, unknown][] = []
  for (const key of Object.keys(order)) {
    if (Object.hasOwn(stored, key)) entries.push([key, stored[key]])
    else if (Object.hasOwn(added, key)) entries.push([key, added[key]])
  }
  const ordered = new Set(entries.map(([key]) => key))
  for (const [key, value] of Object.entries(stored))
    if (!ordered.has(key)) entries.push([key, value])
  // Keys are defined, not assigned: a stored "__proto__" stays a key, never the prototype.
  return Object.fromEntries(entries)
}

/** What a tool's Fusion record imports as today, or null without a readable one. */
function reimported(source: unknown): Tool | null {
  if (!record(source) || source.format !== "fusion" || !record(source.raw))
    return null
  try {
    return fusionTool(source.raw, "", 0)
  } catch {
    return null
  }
}

/** The bundled photo a native catalog record named, which version 2 kept only there. */
function recordedImage(source: unknown): string | null {
  const image = record(source) && record(source.raw) ? source.raw.image : null
  return typeof image === "string" && BUNDLED_IMAGE.test(image) ? image : null
}

/**
 * A version 2 tool record as version 3. The fields version 3 added come from the tool's
 * Fusion record, read as an import reads it today, and a preset material the old import could
 * not read is read again; a native record gives only its bundled photo. Edited values stay as
 * they are.
 */
function fromVersion2(value: Record<string, unknown>) {
  const fresh = reimported(value.source)
  const blank = createTool()
  const tool = withKeys(blank, value, {
    ...picked(fresh ?? blank, ADDED_TOOL_FIELDS),
    image: recordedImage(value.source),
  })
  tool.schemaVersion = 3
  if (record(value.geometry))
    tool.geometry = withKeys(
      blank.geometry,
      value.geometry,
      picked(fresh?.geometry, ADDED_GEOMETRY_FIELDS)
    )
  if (record(value.holder))
    tool.holder = withKeys(
      createHolder(),
      value.holder,
      picked(fresh?.holder, ADDED_HOLDER_FIELDS)
    )
  if (Array.isArray(value.presets))
    tool.presets = value.presets.map((preset: unknown) => {
      if (!record(preset)) return preset
      const match = fresh?.presets.find((item) => item.id === preset.id)
      const upgraded = withKeys(
        createPreset(),
        preset,
        picked(match, ADDED_PRESET_FIELDS)
      )
      if (upgraded.material === null && match?.material)
        upgraded.material = match.material
      return upgraded
    })
  return tool
}

/** A version 3 tool record as version 4, without a 3D model: none was recorded. */
function fromVersion3(value: Record<string, unknown>) {
  const tool = withKeys(createTool(), value, { model: null })
  tool.schemaVersion = 4
  return tool
}

/** The profiles of the Makera probes the app bundles, by their catalog records' builtinId. */
const BUNDLED_PROBES = new Map<unknown, ProbeProfile>([
  ["makera-wired-probe-2", { touch: "z", pointer: true }],
  ["makera-3d-probe", { touch: "xyz", pointer: false }],
])

/**
 * The profile a version 4 record gets: a bundled Makera probe's as its catalog has it; a 3D
 * probe's for any other probe numbered as the 3D probe's slot, which earlier versions bound
 * there (`libraryPreferences`); the profile any other probe starts with; none for anything else.
 */
function recordedProfile(value: Record<string, unknown>): ProbeProfile | null {
  const fresh =
    typeof value.kind === "string" ? defaultProbeProfile(value.kind) : null
  if (fresh === null) return null
  const source = value.source
  const bundled =
    record(source) && record(source.raw)
      ? BUNDLED_PROBES.get(source.raw.builtinId)
      : undefined
  if (bundled) return { ...bundled }
  const number = record(value.postProcess) ? value.postProcess.number : null
  return number === PROBE_3D_TOOL ? { touch: "xyz", pointer: false } : fresh
}

/** A version 4 tool record as version 5: a probe gets a profile, any other tool none. */
function fromVersion4(value: Record<string, unknown>) {
  const tool = withKeys(createTool(), value, { probe: recordedProfile(value) })
  tool.schemaVersion = TOOL_SCHEMA_VERSION
  return tool
}

/**
 * Brings a tool record of an earlier version (stored, exported or saved in a project by
 * earlier versions) up to date, one version at a time. Anything else passes unchanged.
 */
export function upgradeTool(value: unknown): unknown {
  if (!record(value)) return value
  if (value.schemaVersion === 2)
    return fromVersion4(fromVersion3(fromVersion2(value)))
  if (value.schemaVersion === 3) return fromVersion4(fromVersion3(value))
  if (value.schemaVersion === 4) return fromVersion4(value)
  return value
}

/**
 * Atomically restores stored library records, brought up to date; a repeated id gets a unique
 * one.
 */
export function restoreTools(value: unknown): Tool[] | null {
  if (!Array.isArray(value) || value.length > TOOL_COUNT_LIMIT) return null
  const restored: Tool[] = []
  const ids = new Set<string>()
  for (const item of value) {
    const upgraded = upgradeTool(item)
    if (!isTool(upgraded)) return null
    const tool = clone(upgraded)
    tool.id = uniqueId(tool.id, ids)
    restored.push(tool)
  }
  return restored
}
