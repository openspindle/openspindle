import { z } from "zod"
import { fail } from "../errors.ts"
import { isPackagePath } from "../paths.ts"

export const CommitSchema = z
  .string()
  .regex(/^[a-f0-9]{40}$/, "Expected an immutable GitHub commit.")

/** Where an installed package came from; a plugin ID stays bound to its source. */
export const PackageOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("github"),
    repository: z
      .string()
      .regex(
        /^https:\/\/github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9_.-]+$/,
        "Expected a canonical GitHub repository URL."
      ),
    commit: CommitSchema,
  }),
  z.strictObject({
    kind: z.literal("folder"),
    /** Absolute path of a developer's working copy. */
    path: z.string().min(1).max(4096),
    development: z.literal(true),
  }),
  /** A plugin that comes with the app, installed from the app's own files. */
  z.strictObject({ kind: z.literal("bundled") }),
])
export type PackageOrigin = z.infer<typeof PackageOriginSchema>

export type PackageLimits = {
  readonly files: number
  readonly fileBytes: number
  readonly totalBytes: number
}

/**
 * One plugin package, read file by file. Readers refuse files above `maxBytes`; paths
 * are package-relative and already validated.
 */
export interface PackageReader {
  readonly origin: PackageOrigin
  readonly limits: PackageLimits
  readFile: (path: string, maxBytes: number) => Promise<Uint8Array>
}

/**
 * The same identity means the same owner: one repository, one development folder, or the
 * app itself.
 */
export function originIdentity(origin: PackageOrigin): string {
  if (origin.kind === "github")
    return `github:${origin.repository.toLowerCase()}`
  if (origin.kind === "folder") return `folder:${origin.path}`
  return "bundled"
}

/**
 * A host's access to one local folder. Implementations resolve paths inside the folder
 * only, refuse symbolic links that leave it, and read regular files only.
 */
export interface FolderPort {
  /** The canonical absolute folder path. */
  readonly path: string
  readFile: (path: string, maxBytes: number) => Promise<Uint8Array>
}

/**
 * Local folders (a developer's working copy, or a plugin that comes with the app) may carry
 * larger packages, such as a converter's runtime.
 */
export const FOLDER_PACKAGE_LIMITS = {
  files: 1024,
  fileBytes: 256 * 1024 * 1024,
  totalBytes: 1024 * 1024 * 1024,
} as const

function folderReader(
  folder: FolderPort,
  origin: PackageOrigin
): PackageReader {
  return {
    origin,
    limits: FOLDER_PACKAGE_LIMITS,
    readFile: (path, maxBytes) => {
      if (!isPackagePath(path)) fail(`${path} is not a valid package path.`)
      return folder.readFile(path, maxBytes)
    },
  }
}

/** A developer's working copy, installed as a development package. */
export function openFolderSource(folder: FolderPort): PackageReader {
  return folderReader(folder, {
    kind: "folder",
    path: folder.path,
    development: true,
  })
}

/** A plugin that comes with the app, read from the app's own files. */
export function openBundledSource(folder: FolderPort): PackageReader {
  return folderReader(folder, { kind: "bundled" })
}
