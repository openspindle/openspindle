import { zipSync } from "fflate"
import type { Zippable } from "fflate"
import { formatBytes, plural } from "@/domain/primitives"
import { FILE_KINDS } from "@/platform/contract/files"
import { STORAGE_MAX_BYTES } from "@/platform/contract/storage"
import { validateGlb } from "@/formats/models/glb"
import {
  ZipEntryTooLargeError,
  ZipTooManyEntriesError,
  readZipFile,
} from "@/lib/zip"
import type { ZipEntry, ZipFile } from "@/lib/zip"
import { fromBase64, toBase64 } from "../base64-json"
import {
  TOOL_COUNT_LIMIT,
  TOOL_MODEL_BYTES,
  ToolShapeSchema,
  clone,
  isTool,
  record,
  uniqueId,
  validateTool,
} from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { fusionTool, nonempty, optionalText, shapeErrors } from "./fusion"
import { upgradeTool } from "./upgrade"

export type ToolImportResult = {
  tools: Tool[]
  /** Incoming tools already in the library, which the import did not add again. */
  skipped: number
  warnings: string[]
}

/**
 * The tool library file formats: the native library JSON, its zip archive (which also carries
 * tools' photos and 3D models as files), and Fusion 360's JSON, .tools and zip archives.
 */

/** The native library format's tag; libraries exported before it was renamed carry the old one. */
const NATIVE_FORMAT = "openspindle-tool-library"
const NATIVE_FORMATS = new Set([NATIVE_FORMAT, "makera-tool-library"])

const MiB = 1024 * 1024
/**
 * What a library may hold (FILE_KINDS.toolLibrary limits its file). A tool's photo and 3D
 * model take up to 1.3 MB, so jsonBytes and unpackedBytes are not what TOOL_COUNT_LIMIT tools
 * could take but what memory allows.
 */
export const TOOL_LIBRARY_LIMITS = {
  tools: TOOL_COUNT_LIMIT,
  /**
   * A library's JSON, in a file or in an archive's files together: about 16 KB for each of
   * 10,000 tools, above Fusion's records with their provenance (13 KB).
   */
  jsonBytes: 160 * MiB,
  /**
   * Everything an archive unpacks to: its JSON and its tools' photos and 3D models. Those grow
   * by a third as the data URLs a tool keeps, so this is three quarters of the largest library
   * the app stores: no import alone takes a library past what it can store.
   */
  unpackedBytes: (STORAGE_MAX_BYTES / 4) * 3,
} as const

function normalizedFusionGuid(value: unknown): string | null {
  return typeof value === "string"
    ? value.trim().replace(/[{}]/g, "").toLowerCase() || null
    : null
}

/** The tool fields that keep a file as a data URL, and the folder an archive keeps it in. */
const TOOL_FILES = { image: "images", model: "models" } as const
type ToolFileField = keyof typeof TOOL_FILES
const TOOL_FILE_FIELDS = Object.keys(TOOL_FILES) as ToolFileField[]

/** A photo takes three quarters of TOOL_IMAGE_LIMIT at most: its data URL's base64 is larger. */
const PHOTO = { maxBytes: (400_000 / 4) * 3, compress: false }
/**
 * The files an archive keeps for its tools, by extension: their data URL type, the most a tool
 * keeps, and whether zip compression helps (photos are compressed already, models are not).
 * The first extension of a type is the one an export writes.
 */
const ARCHIVE_FILES = new Map([
  ["webp", { mime: "image/webp", ...PHOTO }],
  ["png", { mime: "image/png", ...PHOTO }],
  ["jpg", { mime: "image/jpeg", ...PHOTO }],
  ["jpeg", { mime: "image/jpeg", ...PHOTO }],
  [
    "glb",
    { mime: "model/gltf-binary", maxBytes: TOOL_MODEL_BYTES, compress: true },
  ],
])
/** A file of the archive a tool names, relative to the library's JSON: "models/1.glb". */
const ARCHIVE_PATH =
  /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(?:webp|png|jpe?g|glb)$/i
/** The library's JSON in the archives Spinnvill exports. */
const ARCHIVE_LIBRARY = "tool-library.json"
/**
 * The most entries an archive may list: all a zip without ZIP64 can, and an export writes one
 * per photo and model. A ZIP64 listing may claim billions, each one read in turn.
 */
const ARCHIVE_ENTRIES = 65_535

const extensionOf = (path: string) =>
  path.slice(path.lastIndexOf(".") + 1).toLowerCase()
/** A limit in messages: "256 MB", "293 KB". */
const limitText = (bytes: number) =>
  Number.isInteger(bytes / MiB) ? `${bytes / MiB} MB` : formatBytes(bytes)
/** Unpacks the entries `limit` gives a size limit (null leaves one packed), by name. */
type ArchiveReader = (
  limit: (entry: ZipEntry) => number | null
) => Record<string, Uint8Array>

/**
 * Reads a zip archive's entries within the import's limits, over all its reads: the size each
 * entry states, which it never unpacks past, is checked before it unpacks, and `ZipFile.read`
 * (src/lib/zip.ts) aborts a decompression that overruns that size even when the entry lies
 * about it, so this never inflates more than the limits allow, however an entry misrepresents
 * itself.
 */
function archiveReader(bytes: Uint8Array, fileName: string): ArchiveReader {
  let unpacked = 0
  let archive: ZipFile
  try {
    archive = readZipFile(bytes, ARCHIVE_ENTRIES)
  } catch (error) {
    if (error instanceof ZipTooManyEntriesError)
      throw new Error(
        `Could not open ${fileName}: it lists more than 65,535 files.`
      )
    throw new Error(
      `Could not open ${fileName}: ${error instanceof Error ? error.message : "it is not a zip archive."}`
    )
  }
  return (limit) => {
    const files: Record<string, Uint8Array> = {}
    try {
      for (const entry of archive.entries) {
        const maxBytes = limit(entry)
        if (maxBytes === null) continue
        if (entry.uncompressedSize > maxBytes)
          throw new Error(
            `${entry.name} is larger than ${limitText(maxBytes)}.`
          )
        unpacked += entry.uncompressedSize
        if (unpacked > TOOL_LIBRARY_LIMITS.unpackedBytes)
          throw new Error(
            `it unpacks to more than ${limitText(TOOL_LIBRARY_LIMITS.unpackedBytes)}.`
          )
        try {
          files[entry.name] = archive.read(entry, maxBytes)
        } catch (error) {
          if (error instanceof ZipEntryTooLargeError)
            throw new Error(
              `${entry.name} is larger than ${limitText(maxBytes)}.`
            )
          throw error
        }
      }
      return files
    } catch (error) {
      throw new Error(
        `Could not open ${fileName}: ${error instanceof Error ? error.message : "it is not a zip archive."}`
      )
    }
  }
}

/** The files `paths` name relative to an archive's `folder`, as the data URLs tools keep. */
function archiveFiles(
  read: ArchiveReader,
  folder: string,
  paths: ReadonlySet<string>
): Map<string, string> {
  const named = (name: string) =>
    name.startsWith(folder) && paths.has(name.slice(folder.length))
  const unpacked = read((entry) =>
    named(entry.name)
      ? (ARCHIVE_FILES.get(extensionOf(entry.name))?.maxBytes ?? null)
      : null
  )
  const files = new Map<string, string>()
  for (const [name, bytes] of Object.entries(unpacked)) {
    const type = ARCHIVE_FILES.get(extensionOf(name))
    if (type && named(name))
      files.set(
        name.slice(folder.length),
        `data:${type.mime};base64,${toBase64(bytes)}`
      )
  }
  return files
}

/** One library of a file: the file itself, or a JSON file of an archive. */
type LibraryDocument = {
  /** As messages name it: "tools.json", or "tools.zip/tool-library.json". */
  readonly name: string
  readonly data: unknown
  /**
   * The files `paths` name relative to the library, as data URLs: those its archive holds, or
   * none outside an archive.
   */
  readonly files: (paths: ReadonlySet<string>) => Map<string, string>
}

const NO_FILES = () => new Map<string, string>()

function parseJson(data: Uint8Array, name: string): unknown {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true })
        .decode(data)
        .replace(/^\uFEFF/, "")
    ) as unknown
  } catch {
    throw new Error(`${name} is not valid UTF-8 JSON.`)
  }
}

/** A file's libraries: its JSON, or each JSON file of a zip archive (Fusion's .tools is one). */
function documents(
  input: string | Uint8Array,
  fileName: string
): LibraryDocument[] {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input
  const { maxBytes } = FILE_KINDS.toolLibrary
  const { jsonBytes } = TOOL_LIBRARY_LIMITS
  if (bytes.byteLength > maxBytes)
    throw new Error(`Tool libraries must be ${limitText(maxBytes)} or smaller.`)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    if (bytes.byteLength > jsonBytes)
      throw new Error(
        `Tool libraries must have ${limitText(jsonBytes)} of JSON or less.`
      )
    return [
      { name: fileName, data: parseJson(bytes, fileName), files: NO_FILES },
    ]
  }
  const read = archiveReader(bytes, fileName)
  let json = 0
  let jsonFiles = 0
  const unpacked = read((entry) => {
    if (!/\.json$/i.test(entry.name) || entry.name.startsWith("__MACOSX/"))
      return null
    json += entry.uncompressedSize
    if (++jsonFiles > 256 || json > jsonBytes)
      throw new Error(
        `it holds more than 256 JSON files or ${limitText(jsonBytes)} of JSON.`
      )
    return jsonBytes
  })
  const entries = Object.entries(unpacked).sort(([a], [b]) =>
    a.localeCompare(b)
  )
  if (!entries.length)
    throw new Error("The tool archive contains no JSON libraries.")
  return entries.map(([entry, data]) => {
    const name = `${fileName}/${entry}`
    const folder = entry.slice(0, entry.lastIndexOf("/") + 1)
    return {
      name,
      data: parseJson(data, name),
      files: (paths) => archiveFiles(read, folder, paths),
    }
  })
}

/** The archive file a native tool record's field names, if it names one. */
function namedFile(item: unknown, field: ToolFileField): string | null {
  const value = record(item) ? item[field] : null
  return typeof value === "string" && ARCHIVE_PATH.test(value) ? value : null
}

/**
 * Native tool records with the files they name ("model": "models/1.glb") read back into the
 * data URLs a tool keeps, before anything else reads them. A file the library's archive lacks
 * is an error.
 */
function withFiles(
  items: readonly unknown[],
  document: LibraryDocument,
  fileName: string
): unknown[] {
  const paths = new Set(
    items.flatMap((item) =>
      TOOL_FILE_FIELDS.flatMap((field) => namedFile(item, field) ?? [])
    )
  )
  if (!paths.size) return [...items]
  const files = document.files(paths)
  return items.map((item, index) => {
    if (!record(item)) return item
    const resolved = { ...item }
    for (const field of TOOL_FILE_FIELDS) {
      const path = namedFile(item, field)
      if (path === null) continue
      const file = files.get(path)
      if (file === undefined) {
        const name = nonempty(item.name) ? item.name : `Tool ${index + 1}`
        throw new Error(`${name}: ${path} is not in ${fileName}.`)
      }
      resolved[field] = file
    }
    return resolved
  })
}

/** Refuses a tool whose own 3D model is not one self-contained GLB, as a chosen one must be. */
function checkModel(tool: Tool) {
  if (!tool.model?.startsWith("data:")) return
  try {
    validateGlb(
      fromBase64(tool.model.slice(tool.model.indexOf(",") + 1)),
      TOOL_MODEL_BYTES
    )
  } catch (error) {
    throw new Error(
      `${tool.name}: ${error instanceof Error ? error.message : "its 3D model is unreadable."}`
    )
  }
}

/**
 * Import is atomic and never mutates existing tools. Result contains additions only:
 * Fusion records whose GUID is already in the library and native tools whose
 * content exactly matches an existing tool are skipped, so re-importing a library
 * adds only new or changed tools. It reads native libraries (the archives
 * exportToolLibrary writes, and JSON) and Fusion's JSON, .tools and zip
 * archives, and refuses what would take the library past 10,000 tools.
 */
export function importToolLibrary(
  input: string | Uint8Array,
  fileName = "tool-library.json",
  existing: readonly Tool[] = []
): ToolImportResult {
  const incoming: { tool: Tool; fusionGuid: string | null }[] = []
  let existingContent: Set<string> | null = null
  let unchanged = 0
  let sourceCount = 0
  for (const document of documents(input, fileName)) {
    if (!record(document.data))
      throw new Error(`${document.name} is not a tool library object.`)
    const data = document.data
    if (typeof data.format === "string" && NATIVE_FORMATS.has(data.format)) {
      if (
        data.version !== 2 ||
        data.units !== "mm" ||
        !Array.isArray(data.tools)
      )
        throw new Error("Unsupported native tool library version or units.")
      sourceCount += data.tools.length
      if (sourceCount > TOOL_LIBRARY_LIMITS.tools)
        throw new Error("Tool library exceeds 10,000 tools.")
      for (const stored of withFiles(data.tools, document, fileName)) {
        const value = upgradeTool(stored)
        if (!isTool(value))
          throw new Error(`Invalid native tool: ${shapeErrors(value)[0]}`)
        checkModel(value)
        existingContent ??= new Set(existing.map(toolContentKey))
        if (existingContent.has(toolContentKey(value))) unchanged++
        else incoming.push({ tool: clone(value), fusionGuid: null })
      }
    } else if (Array.isArray(data.data)) {
      sourceCount += data.data.length
      if (sourceCount > TOOL_LIBRARY_LIMITS.tools)
        throw new Error("Tool library exceeds 10,000 tools.")
      data.data.forEach((value: unknown, index) => {
        if (!record(value))
          throw new Error(`Tool ${index + 1} is not an object.`)
        incoming.push({
          tool: fusionTool(value, document.name, index),
          fusionGuid: optionalText(value.guid, "guid"),
        })
      })
    } else
      throw new Error(
        `${document.name} does not contain a recognized tool library.`
      )
  }
  const deduped: Tool[] = []
  const positions = new Map<string, number>()
  const existingGuids = new Set(
    existing
      .filter((tool) => tool.source?.format === "fusion")
      .map((tool) => normalizedFusionGuid(tool.source?.raw?.guid))
      .filter((guid) => guid !== null)
  )
  const skippedGuids = new Set<string>()
  let duplicates = 0
  for (const entry of incoming) {
    const key = normalizedFusionGuid(entry.fusionGuid)
    if (key && existingGuids.has(key)) {
      skippedGuids.add(key)
      continue
    }
    const position = key ? positions.get(key) : undefined
    if (position !== undefined) {
      duplicates++
      if (
        entry.tool.source?.unit === "millimeters" &&
        deduped[position].source?.unit !== "millimeters"
      )
        deduped[position] = entry.tool
    } else {
      if (key) positions.set(key, deduped.length)
      deduped.push(entry.tool)
    }
  }
  const room = Math.max(0, TOOL_LIBRARY_LIMITS.tools - existing.length)
  if (deduped.length > room)
    throw new Error(
      `The library has room for ${plural(room, "more tool")} (it holds at most 10,000), and ${fileName} adds ${deduped.length}.`
    )
  const warnings: string[] = []
  if (skippedGuids.size)
    warnings.push(
      `Skipped ${skippedGuids.size} Fusion ${skippedGuids.size === 1 ? "tool" : "tools"} already in the library.`
    )
  if (unchanged)
    warnings.push(
      `Skipped ${unchanged} unchanged ${unchanged === 1 ? "tool" : "tools"} already in the library.`
    )
  if (duplicates)
    warnings.push(
      `Merged ${duplicates} duplicate Fusion GUID record(s), preferring millimeter definitions.`
    )
  const ids = new Set(existing.map((tool) => tool.id))
  let omittedWarnings = 0
  for (const tool of deduped) {
    tool.id = uniqueId(tool.id, ids)
    for (const warning of validateTool(tool)) {
      if (warnings.length < 100) warnings.push(`${tool.name}: ${warning}`)
      else omittedWarnings++
    }
  }
  if (omittedWarnings)
    warnings.push(`${omittedWarnings} additional geometry warnings.`)
  return { tools: deduped, skipped: skippedGuids.size + unchanged, warnings }
}

/** A data URL as a file for an archive, or null to keep the data URL in the JSON. */
function dataUrlFile(value: string) {
  const prefix = /^data:([\w.+-]+\/[\w.+-]+);base64,/.exec(value)
  const type = prefix
    ? [...ARCHIVE_FILES].find(([, { mime }]) => mime === prefix[1])
    : undefined
  if (!prefix || !type) return null
  const base64 = value.slice(prefix[0].length)
  let bytes: Uint8Array
  try {
    bytes = fromBase64(base64)
  } catch {
    return null
  }
  // Only canonical base64 (padded, no bits past the last byte) comes back as it was.
  if (toBase64(bytes) !== base64) return null
  const [extension, { compress }] = type
  return { extension, compress, bytes }
}

/** JSON with object keys sorted, so equal content always serializes identically. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    record(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : 1))
        )
      : entry
  )
}
/** Normalized tool content without its id: equal keys are exact duplicates. */
function toolContentKey(tool: Tool): string {
  const normalized = ToolShapeSchema.safeParse(tool)
  return canonicalJson({
    ...(normalized.success ? normalized.data : tool),
    id: "",
  })
}

/**
 * The native library as a zip archive: `tool-library.json`, whose tools name their photos and
 * 3D models by paths in the archive ("images/1.webp", "models/1.glb"), and those files, each
 * once; bundled ones stay the paths the app serves them at. It keeps resolved edits and the
 * complete original Fusion record, and is refused where an import would refuse it.
 */
export function exportToolLibrary(tools: readonly Tool[]): Uint8Array {
  if (tools.length > TOOL_LIBRARY_LIMITS.tools || !tools.every(isTool))
    throw new Error("Cannot export an invalid tool library.")
  const { jsonBytes, unpackedBytes } = TOOL_LIBRARY_LIMITS
  const tooLarge = (reason: string) =>
    new Error(`The library is too large to export: ${reason}.`)
  const unpackedTooLarge = () =>
    tooLarge(
      `its tools and their files take more than ${limitText(unpackedBytes)}`
    )
  const files: Zippable = {}
  const paths = new Map<string, string>()
  const counts = new Map<ToolFileField, number>()
  let unpacked = 0
  /** The path of a tool's file in the archive, added once; null keeps the value. */
  const archived = (field: ToolFileField, value: string | null) => {
    if (value === null) return null
    const known = paths.get(value)
    if (known !== undefined) return known
    const file = dataUrlFile(value)
    if (!file) return null
    unpacked += file.bytes.byteLength
    if (unpacked > unpackedBytes) throw unpackedTooLarge()
    const number = (counts.get(field) ?? 0) + 1
    counts.set(field, number)
    const path = `${TOOL_FILES[field]}/${number}.${file.extension}`
    paths.set(value, path)
    files[path] = [file.bytes, { level: file.compress ? 6 : 0 }]
    return path
  }
  const exported = tools.map((tool) => {
    const copy: Record<string, unknown> = { ...tool }
    for (const field of TOOL_FILE_FIELDS) {
      const path = archived(field, tool[field])
      if (path !== null) copy[field] = path
    }
    return copy
  })
  const json = new TextEncoder().encode(
    JSON.stringify(
      { format: NATIVE_FORMAT, version: 2, units: "mm", tools: exported },
      null,
      2
    )
  )
  if (json.byteLength > jsonBytes)
    throw tooLarge(`its tools take more than ${limitText(jsonBytes)} of JSON`)
  if (unpacked + json.byteLength > unpackedBytes) throw unpackedTooLarge()
  const archive = zipSync({ [ARCHIVE_LIBRARY]: json, ...files })
  const { maxBytes } = FILE_KINDS.toolLibrary
  if (archive.byteLength > maxBytes)
    throw tooLarge(`its archive takes more than ${limitText(maxBytes)}`)
  return archive
}
