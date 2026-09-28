import { defineContract } from "@openspindle/rpc"
import type { EventSpec, MethodSpec } from "@openspindle/rpc"
import { z } from "zod"
import {
  AnchorConfigurationSchema,
  HeightMapSchema,
  MachineSnapshotSchema,
  PLUGIN_ACCESSORY_KINDS,
} from "../../../src/machine/contract/index.ts"
import { CapabilitySchema } from "./capabilities.ts"
import type { Requirement } from "./capabilities.ts"
import {
  CompanionEmitSchema,
  CompanionHealthSchema,
  CompanionMethodSchema,
  CompanionStatusSchema,
  ConfirmRequestSchema,
  FrameBootSchema,
  JsonSchema,
  NoticeSchema,
  OPERATION_LIMITS,
  OperationDraftSchema,
  OperationIdSchema,
  OperationPatchSchema,
  OperationSchema,
  PlateIdSchema,
  ProgramFileSchema,
  ProgressSchema,
  SettingValuesSchema,
  ToolChoiceRequestSchema,
  ToolChoiceSchema,
  ToolSchema,
  ViewContextSchema,
  WorkspaceSummarySchema,
} from "./dto.ts"
import { PLATFORMS, PluginIdSchema, VersionSchema } from "./manifest.ts"

export type {
  AnchorConfiguration,
  HeightMap,
  MachineSnapshot,
} from "../../../src/machine/contract/index.ts"

type GuardedMethod = MethodSpec & { readonly requires: Requirement }
type GuardedEvent = EventSpec & { readonly requires: Requirement }

const none = z.undefined()
const done = z.null()

export const PluginAccessorySchema = z.enum(PLUGIN_ACCESSORY_KINDS)

/** Machine access for plugins: read, and the accessories that never move anything. */
export const pluginMachineMethods = {
  "machine.snapshot": {
    params: none,
    result: MachineSnapshotSchema,
    requires: "machine:read",
    timeoutMs: 15_000,
  },
  // Reads may wait for a running program to end; callers cancel instead of timing out.
  "machine.readAnchors": {
    params: none,
    result: AnchorConfigurationSchema,
    requires: "machine:read",
    timeoutMs: 0,
  },
  "machine.readHeightMap": {
    params: none,
    result: HeightMapSchema,
    requires: "machine:read",
    timeoutMs: 0,
  },
  "machine.accessory": {
    params: z.strictObject({
      accessory: PluginAccessorySchema,
      enabled: z.boolean(),
    }),
    result: MachineSnapshotSchema,
    requires: "machine:accessories",
    timeoutMs: 20_000,
  },
} as const satisfies Record<string, GuardedMethod>

/**
 * Served by the app to one plugin frame over its MessagePort. Every method names the
 * requirement the host's capability guard checks before the handler runs.
 */
export const pluginViewContract = defineContract({
  methods: {
    "view.load": {
      params: none,
      result: FrameBootSchema,
      requires: "view",
      timeoutMs: 30_000,
    },
    "view.resize": {
      params: z.strictObject({ height: z.number().min(0).max(100_000) }),
      result: done,
      requires: "view",
    },
    /** Closes the view; `select` shows one of the plugin's own operations. */
    "view.close": {
      params: z
        .strictObject({ select: OperationIdSchema.optional() })
        .optional(),
      result: done,
      requires: "view",
    },
    "ui.notify": { params: NoticeSchema, result: done, requires: "view" },
    "ui.progress": { params: ProgressSchema, result: done, requires: "view" },
    "ui.confirm": {
      params: ConfirmRequestSchema,
      result: z.boolean(),
      requires: "view",
      timeoutMs: 0,
    },
    "workspace.read": {
      params: none,
      result: WorkspaceSummarySchema,
      requires: "workspace:read",
    },
    "operations.list": {
      params: z.strictObject({ plateId: PlateIdSchema.optional() }),
      result: z.array(OperationSchema),
      requires: "operations:write",
    },
    "operations.get": {
      params: z.strictObject({ operationId: OperationIdSchema }),
      result: OperationSchema,
      requires: "operations:write",
    },
    "operations.create": {
      params: z.strictObject({
        plateId: PlateIdSchema,
        operations: z
          .array(OperationDraftSchema)
          .min(1)
          .max(OPERATION_LIMITS.create),
      }),
      result: z.array(OperationSchema),
      requires: "operations:write",
      timeoutMs: 60_000,
    },
    "operations.save": {
      params: z.strictObject({ operation: OperationPatchSchema }),
      result: OperationSchema,
      requires: "operations:write",
      timeoutMs: 60_000,
    },
    "programs.import": {
      params: z.strictObject({
        files: z.array(ProgramFileSchema).min(1).max(20),
      }),
      result: z.object({ imported: z.int().nonnegative() }),
      requires: "programs:import",
      timeoutMs: 60_000,
    },
    "tools.list": {
      params: none,
      result: z.array(ToolSchema),
      requires: "tools:read",
    },
    "tools.choose": {
      params: ToolChoiceRequestSchema,
      result: ToolChoiceSchema,
      requires: "tools:read",
      timeoutMs: 0,
    },
    ...pluginMachineMethods,
    "companion.call": {
      params: z.strictObject({
        method: CompanionMethodSchema,
        params: JsonSchema.optional(),
      }),
      result: JsonSchema,
      requires: "companion",
      timeoutMs: 0,
    },
    "companion.status": {
      params: none,
      result: CompanionStatusSchema,
      requires: "companion",
    },
    "companion.setup": {
      params: none,
      result: CompanionHealthSchema,
      requires: "companion",
      timeoutMs: 0,
    },
  } satisfies Record<string, GuardedMethod>,
  events: {
    "view.context": { params: none, data: ViewContextSchema, requires: "view" },
    "workspace.changed": {
      params: none,
      data: WorkspaceSummarySchema,
      requires: "workspace:read",
    },
    "operations.changed": {
      params: none,
      data: z.object({
        plateId: PlateIdSchema,
        operationIds: z.array(OperationIdSchema),
      }),
      requires: "operations:write",
    },
    "machine.changed": {
      params: none,
      data: MachineSnapshotSchema,
      requires: "machine:read",
    },
    "companion.events": {
      params: none,
      data: CompanionEmitSchema,
      requires: "companion",
    },
    /** The companion's status now and after every change. */
    "companion.status": {
      params: none,
      data: CompanionStatusSchema,
      requires: "companion",
    },
  } satisfies Record<string, GuardedEvent>,
})
export type PluginViewContract = typeof pluginViewContract

export const COMPANION_PROTOCOL = 1

export const CompanionInitializeSchema = z.strictObject({
  protocol: z.literal(COMPANION_PROTOCOL),
  api: z.strictObject({ version: z.int(), revision: z.int() }),
  plugin: z.strictObject({ id: PluginIdSchema, version: VersionSchema }),
  grants: z.array(CapabilitySchema),
  /** What the user set for the manifest's settings; changing one restarts the companion. */
  settings: SettingValuesSchema,
  paths: z.strictObject({
    /** The installed package; treat it as read-only. */
    package: z.string(),
    /** Persistent, private to this plugin. */
    data: z.string(),
    /** Emptied whenever the companion starts and stops. */
    tmp: z.string(),
  }),
  platform: z.enum(PLATFORMS),
})
export type CompanionInitialize = z.infer<typeof CompanionInitializeSchema>

/** Served by a companion process; the host calls it over the companion's private channel. */
export const companionContract = defineContract({
  methods: {
    "openspindle.initialize": {
      params: CompanionInitializeSchema,
      result: z.object({
        protocol: z.literal(COMPANION_PROTOCOL),
        /** Whether `setup` does anything (installs dependencies, for example). */
        setup: z.boolean(),
      }),
      timeoutMs: 15_000,
    },
    health: { params: none, result: CompanionHealthSchema, timeoutMs: 15_000 },
    setup: { params: none, result: CompanionHealthSchema, timeoutMs: 0 },
    invoke: {
      params: z.strictObject({
        method: CompanionMethodSchema,
        params: JsonSchema.optional(),
      }),
      result: JsonSchema,
      timeoutMs: 0,
    },
    "openspindle.shutdown": { params: none, result: done, timeoutMs: 5_000 },
  },
  events: {},
})
export type CompanionContract = typeof companionContract

/** Served by the host to a companion: logging, progress, events for its views, machine:read. */
export const companionHostContract = defineContract({
  methods: {
    "host.log": {
      params: z.strictObject({
        level: z.enum(["debug", "info", "warn", "error"]),
        message: z.string().max(4000),
      }),
      result: done,
      requires: "companion",
    },
    "host.progress": {
      params: ProgressSchema,
      result: done,
      requires: "companion",
    },
    "host.emit": {
      params: CompanionEmitSchema,
      result: done,
      requires: "companion",
    },
    "machine.snapshot": pluginMachineMethods["machine.snapshot"],
  } satisfies Record<string, GuardedMethod>,
  events: {},
})
export type CompanionHostContract = typeof companionHostContract
