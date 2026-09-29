import { defineContract } from "@openspindle/rpc"
import {
  CapabilitySchema,
  CompanionEmitSchema,
  CompanionHealthSchema,
  CompanionMethodSchema,
  CompanionStatusSchema,
  InstallReviewSchema,
  JsonSchema,
  PackageOriginSchema,
  PluginAccessorySchema,
  PluginIdSchema,
  PluginIdentitySchema,
  ProgressSchema,
  SettingValuesSchema,
  Sha256Schema,
  StoredManifestSchema,
  VersionSchema,
  ViewDeclarationSchema,
  apiIncompatibility,
} from "@openspindle/plugin-core"
import type {
  CompanionStatus,
  InstalledPluginRecord,
} from "@openspindle/plugin-core"
import { z } from "zod"
import {
  AnchorConfigurationSchema,
  HeightMapSchema,
  MachineSnapshotSchema,
} from "../../machine/contract/index.ts"

const none = z.undefined()
const PluginRef = z.strictObject({ pluginId: PluginIdSchema })

/** An installed plugin as the manager and the workspace see it; files stay in main. */
export const PluginSummarySchema = z.object({
  id: PluginIdSchema,
  version: VersionSchema,
  manifest: StoredManifestSchema,
  /**
   * Why the plugin cannot run: it was built for a plugin API this OpenSpindle does not
   * implement. It serves nothing until it is updated; null when it can run.
   */
  incompatible: z.string().nullable(),
  source: PackageOriginSchema,
  enabled: z.boolean(),
  installedAt: z.string(),
  grants: z.array(CapabilitySchema),
  files: z.int().nonnegative(),
  bytes: z.int().nonnegative(),
  digest: Sha256Schema,
  /** What the user set for the manifest's settings. */
  settings: SettingValuesSchema,
  /** Null when the plugin has no companion. */
  companion: CompanionStatusSchema.nullable(),
})
export type PluginSummary = z.infer<typeof PluginSummarySchema>

/** An installed record as every host reports it; the package files stay with the host. */
export function pluginSummary(
  record: InstalledPluginRecord,
  companion: CompanionStatus | null
): PluginSummary {
  return {
    id: record.id,
    version: record.version,
    manifest: record.manifest,
    incompatible: apiIncompatibility(record.manifest),
    source: record.source,
    enabled: record.enabled,
    installedAt: record.installedAt,
    grants: record.grants,
    files: record.inventory.length,
    bytes: record.inventory.reduce((total, entry) => total + entry.bytes, 0),
    digest: record.digest,
    settings: record.settings,
    companion,
  }
}

/** Whether a plugin serves its views, programs and companion: enabled, and able to run. */
export const isPluginUsable = (
  plugin: Pick<PluginSummary, "enabled" | "incompatible">
) => plugin.enabled && plugin.incompatible === null

export const InstallRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("github"),
    repository: z.string().max(500),
  }),
  /** The main process asks for the folder with a native dialog. */
  z.strictObject({ kind: z.literal("folder") }),
])
export type InstallRequest = z.infer<typeof InstallRequestSchema>

export const PrepareInstallResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("canceled") }),
  z.object({ status: z.literal("review"), review: InstallReviewSchema }),
])
export type PrepareInstallResult = z.infer<typeof PrepareInstallResultSchema>

export const ChooseSettingResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("canceled") }),
  z.object({ status: z.literal("chosen"), plugin: PluginSummarySchema }),
])
export type ChooseSettingResult = z.infer<typeof ChooseSettingResultSchema>

/** What a plugin frame is started with; read and verified against the inventory. */
export const PluginBundleSchema = z.object({
  plugin: PluginIdentitySchema,
  views: z.array(ViewDeclarationSchema),
  script: z.string(),
  styles: z.string().nullable(),
})
export type PluginBundle = z.infer<typeof PluginBundleSchema>

export const CompanionLogEntrySchema = z.object({
  at: z.number(),
  level: z.enum(["debug", "info", "warn", "error"]),
  source: z.enum(["host", "companion", "stdout", "stderr"]),
  message: z.string(),
})
export type CompanionLogEntry = z.infer<typeof CompanionLogEntrySchema>

export const CompanionEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("emit"), event: CompanionEmitSchema }),
  z.object({ kind: z.literal("progress"), progress: ProgressSchema }),
  z.object({ kind: z.literal("status"), status: CompanionStatusSchema }),
])
export type CompanionEvent = z.infer<typeof CompanionEventSchema>

/**
 * The in-flight budget of what plugin views call through the broker: however many calls
 * plugins keep waiting, main still serves the app's own, such as enabling or removing one.
 */
const PLUGIN_BUDGET = "plugins"

/**
 * Plugin management and plugin-scoped services the main process serves to the app.
 * Machine and companion calls run in main under the plugin's own principal and grants.
 */
export const pluginMethods = {
  "plugins.list": {
    params: none,
    result: z.array(PluginSummarySchema),
    timeoutMs: 15_000,
  },
  // Folder installs wait on a native dialog; GitHub installs have their own deadline.
  "plugins.prepareInstall": {
    params: InstallRequestSchema,
    result: PrepareInstallResultSchema,
    timeoutMs: 0,
  },
  "plugins.prepareUpdate": {
    params: PluginRef,
    result: PrepareInstallResultSchema,
    timeoutMs: 180_000,
  },
  "plugins.confirmInstall": {
    params: z.strictObject({ reviewId: z.uuid() }),
    result: PluginSummarySchema,
    timeoutMs: 120_000,
  },
  "plugins.discardInstall": {
    params: z.strictObject({ reviewId: z.uuid() }),
    result: z.null(),
  },
  "plugins.setEnabled": {
    params: z.strictObject({ pluginId: PluginIdSchema, enabled: z.boolean() }),
    result: PluginSummarySchema,
    timeoutMs: 30_000,
  },
  "plugins.remove": { params: PluginRef, result: z.null(), timeoutMs: 30_000 },
  // Checks the value and restarts the plugin's companion with it.
  "plugins.setSetting": {
    params: z.strictObject({
      pluginId: PluginIdSchema,
      settingId: z.string().max(64),
      value: z.string().max(4096).nullable(),
    }),
    result: PluginSummarySchema,
    timeoutMs: 60_000,
  },
  // Waits on a native dialog, then stores what was chosen as setSetting does.
  "plugins.chooseSetting": {
    params: z.strictObject({
      pluginId: PluginIdSchema,
      settingId: z.string().max(64),
    }),
    result: ChooseSettingResultSchema,
    timeoutMs: 0,
  },
  "plugins.readBundle": {
    params: PluginRef,
    result: PluginBundleSchema,
    timeoutMs: 30_000,
  },
  "plugins.renderProgram": {
    params: z.strictObject({
      pluginId: PluginIdSchema,
      programId: z.string().max(64),
      values: z.record(z.string(), z.union([z.number(), z.boolean()])),
    }),
    result: z.object({ name: z.string(), source: z.string() }),
  },
  "plugins.companion.status": {
    params: PluginRef,
    result: CompanionStatusSchema,
    budget: PLUGIN_BUDGET,
  },
  "plugins.companion.logs": {
    params: PluginRef,
    result: z.array(CompanionLogEntrySchema),
  },
  "plugins.companion.setup": {
    params: PluginRef,
    result: CompanionHealthSchema,
    timeoutMs: 0,
    budget: PLUGIN_BUDGET,
  },
  "plugins.companion.restart": {
    params: PluginRef,
    result: CompanionStatusSchema,
    timeoutMs: 60_000,
  },
  "plugins.companion.call": {
    params: z.strictObject({
      pluginId: PluginIdSchema,
      method: CompanionMethodSchema,
      params: JsonSchema.optional(),
    }),
    result: JsonSchema,
    timeoutMs: 0,
    budget: PLUGIN_BUDGET,
  },
  "plugins.machine.snapshot": {
    params: PluginRef,
    result: MachineSnapshotSchema,
    timeoutMs: 15_000,
    budget: PLUGIN_BUDGET,
  },
  "plugins.machine.readAnchors": {
    params: PluginRef,
    result: AnchorConfigurationSchema,
    timeoutMs: 0,
    budget: PLUGIN_BUDGET,
  },
  "plugins.machine.readHeightMap": {
    params: PluginRef,
    result: HeightMapSchema,
    timeoutMs: 0,
    budget: PLUGIN_BUDGET,
  },
  "plugins.machine.accessory": {
    params: z.strictObject({
      pluginId: PluginIdSchema,
      accessory: PluginAccessorySchema,
      enabled: z.boolean(),
    }),
    result: MachineSnapshotSchema,
    timeoutMs: 20_000,
    budget: PLUGIN_BUDGET,
  },
} as const

export const pluginEvents = {
  /** The installed plugins, again after every install, change or companion transition. */
  "plugins.changed": { params: none, data: z.array(PluginSummarySchema) },
  "plugins.machine.changed": { params: PluginRef, data: MachineSnapshotSchema },
  /** Subscribing holds the companion: on-view companions start and stay up meanwhile. */
  "plugins.companion.events": { params: PluginRef, data: CompanionEventSchema },
} as const

export const pluginRpcContract = defineContract({
  methods: pluginMethods,
  events: pluginEvents,
})
export type PluginRpcContract = typeof pluginRpcContract
