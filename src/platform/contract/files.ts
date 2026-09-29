import { z } from "zod"
import {
  hasControlCharacter,
  utf8ByteLength,
} from "../../machine/contract/index.ts"

const MiB = 1024 * 1024

export type FileKindSpec = {
  readonly title: string
  /** Extensions accepted when opening or dropping a file. */
  readonly extensions: readonly string[]
  /** Extensions a saved file may use; the first is the default. */
  readonly saveExtensions: readonly string[]
  /** Saved files hold bytes, such as a zip archive, rather than text. */
  readonly binary?: boolean
  readonly maxBytes: number
  readonly mime: string
}

/** The single registry for every file the app opens or saves, shared by all hosts. */
export const FILE_KINDS = {
  project: {
    title: "STEP-NC project",
    extensions: ["stpnc", "step", "stp", "p21"],
    saveExtensions: ["stpnc"],
    maxBytes: 100 * MiB,
    mime: "application/step",
  },
  program: {
    title: "NC program",
    extensions: ["nc", "cnc", "gcode", "tap", "ngc"],
    saveExtensions: ["nc", "cnc"],
    maxBytes: 20 * MiB,
    mime: "text/plain",
  },
  /**
   * OpenSpindle saves a tool library as a zip archive of its JSON and the tools' photos and 3D
   * models; it opens those, the JSON of its earlier versions and Fusion 360's JSON and .tools.
   * Hundreds of MB, not the 13 GB of 10,000 tools with the largest photo and model: an import
   * holds the file, what it unpacks to and the files as data URLs in memory at once.
   */
  toolLibrary: {
    title: "Tool library",
    extensions: ["zip", "json", "tools"],
    saveExtensions: ["zip"],
    binary: true,
    maxBytes: 256 * MiB,
    mime: "application/zip",
  },
  /** A copy of stored app data that could not be restored. */
  recovery: {
    title: "Recovery copy",
    extensions: ["json"],
    saveExtensions: ["json"],
    maxBytes: 512 * MiB,
    mime: "application/json",
  },
  /** The recent protocol exchange with the machine (Help › Export Protocol Trace). */
  trace: {
    title: "Protocol trace",
    extensions: ["txt"],
    saveExtensions: ["txt"],
    maxBytes: 32 * MiB,
    mime: "text/plain",
  },
  /** The app's log (Help › Export Log, or Download log in the error dialog). */
  log: {
    title: "Log",
    extensions: ["log"],
    saveExtensions: ["log"],
    maxBytes: 32 * MiB,
    mime: "text/plain",
  },
} as const satisfies Record<string, FileKindSpec>

export const FileKindSchema = z.enum([
  "project",
  "program",
  "toolLibrary",
  "recovery",
  "trace",
  "log",
])
export type FileKind = z.infer<typeof FileKindSchema>

const extensionOf = (name: string) =>
  /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ""

export function hasFileExtension(
  kind: FileKind,
  name: string,
  purpose: "open" | "save" = "open"
): boolean {
  const spec = FILE_KINDS[kind]
  const allowed: readonly string[] =
    purpose === "open" ? spec.extensions : spec.saveExtensions
  return allowed.includes(extensionOf(name))
}

/** A bare, safe file name: no path separators, no leading dot, no control characters. */
export function fileNameError(kind: FileKind, name: string): string | null {
  const spec = FILE_KINDS[kind]
  if (
    name.length > 200 ||
    !/^[^./\\:][^/\\:]*$/.test(name) ||
    hasControlCharacter(name) ||
    !hasFileExtension(kind, name, "save")
  )
    return `Choose a safe ${spec.saveExtensions.map((e) => `.${e}`).join(" or ")} file name.`
  return null
}

export function fileContentsError(
  kind: FileKind,
  contents: string
): string | null {
  const spec = FILE_KINDS[kind]
  if (!contents.trim() || contents.includes("\0"))
    return `The ${spec.title.toLowerCase()} must contain text without NUL characters.`
  if (utf8ByteLength(contents) > spec.maxBytes)
    return `The ${spec.title.toLowerCase()} exceeds the ${spec.maxBytes / MiB} MB limit.`
  return null
}

/** Derives a safe save name from any label, falling back to the kind's default. */
export function suggestedFileName(
  kind: FileKind,
  label: string,
  fallbackStem: string
): string {
  const spec = FILE_KINDS[kind]
  const extension = hasFileExtension(kind, label, "save")
    ? extensionOf(label)
    : spec.saveExtensions[0]
  const stem = label
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\\/:]/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 180)
  const candidate = `${stem || fallbackStem}.${extension}`
  return fileNameError(kind, candidate) === null
    ? candidate
    : `${fallbackStem}.${spec.saveExtensions[0]}`
}

export const OpenFileRequestSchema = z.strictObject({ kind: FileKindSchema })
export type OpenFileRequest = z.infer<typeof OpenFileRequestSchema>

export const OpenFileResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("opened"),
    fileName: z.string().min(1).max(1024),
    contents: z.string(),
  }),
  z.strictObject({ status: z.literal("canceled") }),
])
export type OpenFileResult = z.infer<typeof OpenFileResultSchema>

/** At most this many files the system hands the app at once are opened. */
export const MAX_OPENED_FILES = 100

/**
 * Files the system asked the app to open (Finder's Open With, a double-click, a drop on the
 * Dock icon), read: NC programs and projects, which the workspace takes as it takes dropped
 * files, and those that could not be read, with why.
 */
export const OpenedFilesSchema = z.strictObject({
  files: z
    .array(
      z.strictObject({
        kind: z.enum(["program", "project"]),
        fileName: z.string().min(1).max(1024),
        contents: z.string(),
      })
    )
    .max(MAX_OPENED_FILES),
  problems: z
    .array(
      z.strictObject({
        fileName: z.string().min(1).max(1024),
        message: z.string(),
      })
    )
    .max(MAX_OPENED_FILES),
})
export type OpenedFiles = z.infer<typeof OpenedFilesSchema>

/** A binary file's contents cross the port as a structured clone, never as base64 text. */
const FileBytesSchema = z.custom<Uint8Array>(
  (value) => value instanceof Uint8Array,
  "Expected bytes."
)

/** What a save may write: text for a text kind, bytes for a binary one, within its limit. */
function saveContentsError(
  kind: FileKind,
  contents: string | Uint8Array
): string | null {
  const spec: FileKindSpec = FILE_KINDS[kind]
  const title = spec.title.toLowerCase()
  if (typeof contents === "string")
    return spec.binary
      ? `The ${title} is saved as bytes, not text.`
      : fileContentsError(kind, contents)
  if (!spec.binary) return `The ${title} is saved as text, not bytes.`
  if (!contents.byteLength) return `The ${title} is empty.`
  if (contents.byteLength > spec.maxBytes)
    return `The ${title} exceeds the ${spec.maxBytes / MiB} MB limit.`
  return null
}

export const SaveFileRequestSchema = z
  .strictObject({
    kind: FileKindSchema,
    suggestedName: z.string().min(1).max(200),
    /** Text, or bytes for a binary kind. */
    contents: z.union([z.string(), FileBytesSchema]),
  })
  .superRefine((request, context) => {
    const nameError = fileNameError(request.kind, request.suggestedName)
    if (nameError) context.addIssue({ code: "custom", message: nameError })
    const contentsError = saveContentsError(request.kind, request.contents)
    if (contentsError)
      context.addIssue({ code: "custom", message: contentsError })
  })
export type SaveFileRequest = z.infer<typeof SaveFileRequestSchema>

export const SaveFileResultSchema = z.strictObject({
  status: z.enum(["saved", "canceled"]),
  fileName: z.string(),
})
export type SaveFileResult = z.infer<typeof SaveFileResultSchema>

/** Reads and validates an opened or dropped file's text for the given kind. */
export function validateOpenedFile(
  kind: FileKind,
  fileName: string,
  contents: string
): { fileName: string; contents: string } {
  if (!hasFileExtension(kind, fileName))
    throw new Error(
      `Choose a ${FILE_KINDS[kind].extensions.map((e) => `.${e}`).join(", ")} file.`
    )
  const error = fileContentsError(kind, contents)
  if (error) throw new Error(error)
  return { fileName, contents }
}
