import { z } from "zod"
import { fail } from "../errors.ts"
import {
  MANIFEST_FILE,
  assertPlatform,
  declaredFiles,
  parseManifest,
} from "../manifest.ts"
import type {
  DeclaredFile,
  Manifest,
  PackageFileRole,
  Platform,
} from "../manifest.ts"
import { PROCESS_PLUGIN_LIMITS, validateTemplate } from "../templates.ts"
import { Sha256Schema, decodeUtf8, parseJson } from "../text.ts"
import type { Sha256 } from "./hash.ts"
import type { PackageOrigin, PackageReader } from "./source.ts"

export const InventoryEntrySchema = z.strictObject({
  path: z.string().min(1).max(240),
  bytes: z.int().nonnegative(),
  sha256: Sha256Schema,
})
export type InventoryEntry = z.infer<typeof InventoryEntrySchema>

/** Every file of an installed package with its size and SHA-256, sorted by path. */
export const InventorySchema = z
  .array(InventoryEntrySchema)
  .max(1024)
  .refine(
    (entries) =>
      entries.every(
        (entry, index) => index === 0 || entries[index - 1].path < entry.path
      ),
    "Inventory entries must be sorted and unique."
  )
export type Inventory = z.infer<typeof InventorySchema>

/** Receives each validated file as it is read, so packages never sit in memory whole. */
export interface PackageSink {
  write: (file: {
    readonly path: string
    readonly bytes: Uint8Array
    readonly executable: boolean
  }) => Promise<void>
}

export type ValidatePackageOptions = {
  /** The host's platform; null on a computer no companion targets. */
  readonly platform: Platform | null
  readonly sha256: Sha256
  readonly sink?: PackageSink
}

export type ValidatedPackage = {
  readonly origin: PackageOrigin
  readonly manifest: Manifest
  readonly inventory: Inventory
  /** SHA-256 over the inventory: one identity for the package contents. */
  readonly digest: string
  readonly totalBytes: number
}

const TEXT_LIMITS: Partial<Record<PackageFileRole, number>> = {
  template: PROCESS_PLUGIN_LIMITS.sourceBytes,
  view: 4 * 1024 * 1024,
  styles: 1024 * 1024,
}

const ROLE_LABELS: Record<PackageFileRole, string> = {
  template: "Program template",
  view: "View bundle",
  styles: "View styles",
  companion: "Companion program",
  asset: "Package file",
}

/** Text files are strict UTF-8; templates are checked against their programs. */
function checkContents(
  file: DeclaredFile,
  bytes: Uint8Array,
  manifest: Manifest
): number {
  if (
    file.role !== "template" &&
    file.role !== "view" &&
    file.role !== "styles"
  )
    return 0
  const text = decodeUtf8(bytes, `${ROLE_LABELS[file.role]} ${file.path}`)
  if (text.includes("\0"))
    fail(`${ROLE_LABELS[file.role]} ${file.path} contains a NUL character.`)
  if (file.role === "view" && !text.trim())
    fail(`View bundle ${file.path} is empty.`)
  if (file.role !== "template") return 0
  for (const program of manifest.programs.filter(
    (item) => item.file === file.path
  ))
    validateTemplate(text, program)
  return bytes.byteLength
}

/**
 * The single install pipeline for every source and host: reads the manifest, refuses a
 * plugin for another platform, then reads, checks, hashes and forwards every declared file
 * within the source's limits.
 */
export async function validatePackage(
  reader: PackageReader,
  options: ValidatePackageOptions
): Promise<ValidatedPackage> {
  const { limits, origin } = reader
  const manifestBytes = await reader.readFile(
    MANIFEST_FILE,
    PROCESS_PLUGIN_LIMITS.manifestBytes
  )
  const manifest = parseManifest(
    parseJson(decodeUtf8(manifestBytes, MANIFEST_FILE), MANIFEST_FILE)
  )
  assertPlatform(manifest, options.platform)
  const files = declaredFiles(manifest, options.platform)
  if (files.length + 1 > limits.files)
    fail(`A plugin package may contain at most ${limits.files} files.`)

  const inventory: InventoryEntry[] = []
  let totalBytes = 0
  let templateBytes = 0
  const accept = async (file: DeclaredFile, bytes: Uint8Array) => {
    totalBytes += bytes.byteLength
    if (totalBytes > limits.totalBytes)
      fail(
        `The plugin package exceeds ${Math.round(limits.totalBytes / 1024 / 1024)} MiB.`
      )
    inventory.push({
      path: file.path,
      bytes: bytes.byteLength,
      sha256: await options.sha256(bytes),
    })
    await options.sink?.write({
      path: file.path,
      bytes,
      executable: file.executable,
    })
  }

  await accept(
    { path: MANIFEST_FILE, role: "asset", executable: false },
    manifestBytes
  )
  for (const file of files) {
    const bytes = await reader.readFile(
      file.path,
      Math.min(TEXT_LIMITS[file.role] ?? limits.fileBytes, limits.fileBytes)
    )
    templateBytes += checkContents(file, bytes, manifest)
    if (templateBytes > PROCESS_PLUGIN_LIMITS.totalSourceBytes)
      fail("Plugin program sources exceed 1 MB.")
    await accept(file, bytes)
  }
  inventory.sort((a, b) => (a.path < b.path ? -1 : 1))
  const digest = await options.sha256(
    new TextEncoder().encode(JSON.stringify(inventory))
  )
  return { origin, manifest, inventory, digest, totalBytes }
}

/** Finds a file's inventory entry, so hosts can verify bytes before use. */
export function inventoryEntry(
  inventory: Inventory,
  path: string
): InventoryEntry {
  return (
    inventory.find((entry) => entry.path === path) ??
    fail(`${path} is not part of the installed package.`)
  )
}
