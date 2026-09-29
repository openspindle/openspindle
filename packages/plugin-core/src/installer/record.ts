import { z } from "zod"
import {
  CAPABILITY_INFO,
  CapabilitySchema,
  diffPermissions,
} from "../capabilities.ts"
import type { Capability } from "../capabilities.ts"
import { SettingValuesSchema } from "../dto.ts"
import type { SettingValues } from "../dto.ts"
import { fail } from "../errors.ts"
import {
  PluginIdSchema,
  StoredManifestSchema,
  VersionSchema,
  ViewDeclarationSchema,
} from "../manifest.ts"
import { Sha256Schema, parseWith } from "../text.ts"
import { InventorySchema } from "./package.ts"
import type { ValidatedPackage } from "./package.ts"
import { PackageOriginSchema, originIdentity } from "./source.ts"
import type { PackageOrigin } from "./source.ts"

/**
 * One installed package as the host's registry stores it. Its manifest may target a plugin
 * API this host no longer implements, after an update of the host: the plugin stays installed
 * and keeps its settings, but serves nothing until it is updated (`apiIncompatibility`).
 */
export const InstalledPluginRecordSchema = z
  .strictObject({
    id: PluginIdSchema,
    version: VersionSchema,
    source: PackageOriginSchema,
    manifest: StoredManifestSchema,
    inventory: InventorySchema,
    digest: Sha256Schema,
    enabled: z.boolean(),
    installedAt: z.iso.datetime(),
    /** Granted at install from the manifest's permissions; never widened at runtime. */
    grants: z.array(CapabilitySchema),
    /** What the user set for the manifest's settings; an update keeps them. */
    settings: SettingValuesSchema.default({}),
  })
  .superRefine((record, context) => {
    if (
      record.id !== record.manifest.id ||
      record.version !== record.manifest.version
    )
      context.addIssue({
        code: "custom",
        message: "The record does not match its manifest.",
      })
    if (
      record.grants.some(
        (grant) => !record.manifest.permissions.includes(grant)
      )
    )
      context.addIssue({
        code: "custom",
        message: "Grants must be permissions the manifest requests.",
      })
    if (
      Object.keys(record.settings).some(
        (id) => !record.manifest.settings.some((setting) => setting.id === id)
      )
    )
      context.addIssue({
        code: "custom",
        message: "Settings must be ones the manifest declares.",
      })
  })
export type InstalledPluginRecord = z.infer<typeof InstalledPluginRecordSchema>

/**
 * A plugin ID stays bound to the repository (or development folder) it was first installed
 * from.
 */
export function assertInstallable(
  existing: InstalledPluginRecord | undefined,
  origin: PackageOrigin
) {
  if (existing && originIdentity(existing.source) !== originIdentity(origin))
    fail(
      "This plugin ID already belongs to another plugin. It cannot be replaced."
    )
}

/**
 * Everything granted is what the manifest asks for; there are no per-call prompts. The
 * settings are the ones the plugin had, less those its manifest no longer declares.
 */
export function createInstalledRecord(
  validated: ValidatedPackage,
  options: {
    readonly installedAt: Date
    readonly enabled: boolean
    readonly settings: SettingValues
  }
): InstalledPluginRecord {
  const declared = new Set(
    validated.manifest.settings.map((setting) => setting.id)
  )
  return parseWith(InstalledPluginRecordSchema, {
    id: validated.manifest.id,
    version: validated.manifest.version,
    source: validated.origin,
    manifest: validated.manifest,
    inventory: validated.inventory,
    digest: validated.digest,
    enabled: options.enabled,
    installedAt: options.installedAt.toISOString(),
    grants: validated.manifest.permissions,
    settings: Object.fromEntries(
      Object.entries(options.settings).filter(([id]) => declared.has(id))
    ),
  })
}

const PermissionReviewSchema = z.object({
  capability: CapabilitySchema,
  title: z.string(),
  description: z.string(),
  /** New with this install or update, as opposed to granted before. */
  added: z.boolean(),
})

/** What the user reviews before an install or update is committed. */
export const InstallReviewSchema = z.object({
  reviewId: z.string(),
  plugin: z.object({
    id: PluginIdSchema,
    name: z.string(),
    version: VersionSchema,
    description: z.string(),
  }),
  source: PackageOriginSchema,
  previous: z
    .object({ version: VersionSchema, enabled: z.boolean() })
    .nullable(),
  permissions: z.array(PermissionReviewSchema),
  removedPermissions: z.array(CapabilitySchema),
  /** Companions run on this computer with the user's own file access. */
  companion: z
    .object({
      runtime: z.enum(["node", "native"]),
      activation: z.enum(["on-demand", "on-view"]),
    })
    .nullable(),
  /** Package files installed with execute permission, for the companion to run. */
  executables: z.array(z.string()),
  views: z.array(ViewDeclarationSchema),
  programs: z.int().nonnegative(),
  files: z.int().nonnegative(),
  bytes: z.int().nonnegative(),
})
export type InstallReview = z.infer<typeof InstallReviewSchema>

export function createInstallReview(
  reviewId: string,
  validated: ValidatedPackage,
  existing: InstalledPluginRecord | undefined
): InstallReview {
  const { manifest } = validated
  const previous: readonly Capability[] = existing?.grants ?? []
  const diff = diffPermissions(previous, manifest.permissions)
  return {
    reviewId,
    plugin: {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
    },
    source: validated.origin,
    previous: existing
      ? { version: existing.version, enabled: existing.enabled }
      : null,
    permissions: manifest.permissions.map((capability) => ({
      capability,
      ...CAPABILITY_INFO[capability],
      added: diff.added.includes(capability),
    })),
    removedPermissions: diff.removed,
    companion: manifest.companion
      ? {
          runtime: manifest.companion.runtime,
          activation: manifest.companion.activation,
        }
      : null,
    executables: manifest.executables,
    views: manifest.ui?.views ?? [],
    programs: manifest.programs.length,
    files: validated.inventory.length,
    bytes: validated.totalBytes,
  }
}
