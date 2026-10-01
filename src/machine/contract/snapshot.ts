import { z } from "zod"
import { AnchorConfigurationSchema } from "./anchors.ts"
import { COMMAND_KINDS, ControlLimitsSchema } from "./commands.ts"
import { JobStateSchema } from "./job.ts"
import { DisplayNameSchema, LocalIPv4Schema, PortSchema } from "./primitives.ts"
import { TelemetrySchema } from "./telemetry.ts"

/** The machine's model, as its firmware adapter names it; fixture kits are made for models. */
export const MachineModelSchema = DisplayNameSchema
export type MachineModel = z.infer<typeof MachineModelSchema>

export const ConnectTargetSchema = z.strictObject({
  host: LocalIPv4Schema,
  port: PortSchema,
  name: DisplayNameSchema.optional(),
})
export type ConnectTarget = z.infer<typeof ConnectTargetSchema>

/**
 * The user confirmed leaving a running job. Disconnecting never stops the program and the
 * app's Stop goes with the connection, so while a job is active the controller refuses to
 * disconnect, or to connect to another device, without it (`confirmation-required`).
 */
const ConfirmedSchema = z.boolean().optional()

export const ConnectRequestSchema = ConnectTargetSchema.extend({
  confirmed: ConfirmedSchema,
})
export type ConnectRequest = z.infer<typeof ConnectRequestSchema>

export const DisconnectRequestSchema = z.strictObject({
  confirmed: ConfirmedSchema,
})
export type DisconnectRequest = z.infer<typeof DisconnectRequestSchema>

export const NetworkDeviceSchema = z.object({
  name: DisplayNameSchema,
  host: LocalIPv4Schema,
  port: PortSchema,
  busy: z.boolean(),
})
export type NetworkDevice = z.infer<typeof NetworkDeviceSchema>

export const ConnectedDeviceSchema = z.object({
  name: DisplayNameSchema,
  host: LocalIPv4Schema,
  port: PortSchema,
  model: MachineModelSchema,
})
export type ConnectedDevice = z.infer<typeof ConnectedDeviceSchema>

/** Stable identity used for fixture profiles and height maps. */
export const machineId = (device: Pick<ConnectedDevice, "model" | "name">) =>
  `${device.model}:${device.name}`

export const MachineFeaturesSchema = z.object({
  /** Automatic tool changer; manual machines wait in Tool state instead. */
  atc: z.boolean(),
  camera: z.boolean(),
  bedClean: z.boolean(),
  /** Stored anchors, which stock, fixtures and the work origin can be kept relative to. */
  anchors: z.boolean(),
})
export type MachineFeatures = z.infer<typeof MachineFeaturesSchema>

export const AVAILABILITY_KEYS = [
  ...COMMAND_KINDS,
  "run",
  "readAnchors",
  "writeAnchors",
  "readHeightMap",
  "stop",
  "reset",
  /** A line typed in the console. */
  "console",
] as const
export const AvailabilityKeySchema = z.enum(AVAILABILITY_KEYS)
export type AvailabilityKey = z.infer<typeof AvailabilityKeySchema>

/** The single source of every enabled/disabled decision and its reason. */
export const AvailabilitySchema = z.object({
  allowed: z.boolean(),
  /** Allowed, but it waits until the running job ends. */
  deferred: z.boolean(),
  reason: z.string().nullable(),
})
export type Availability = z.infer<typeof AvailabilitySchema>

export const ActivityKindSchema = z.enum([
  "connect",
  "command",
  "stop",
  "anchors",
  "heightMap",
  "run",
])
export const ActivitySchema = z.object({
  kind: ActivityKindSchema,
  label: z.string(),
  startedAt: z.number(),
})
export type Activity = z.infer<typeof ActivitySchema>

export const DeferredOperationSchema = z.object({
  id: z.string(),
  kind: z.enum(["readAnchors", "readHeightMap"]),
  requestedAt: z.number(),
})
export type DeferredOperation = z.infer<typeof DeferredOperationSchema>

export const MachineSnapshotSchema = z.object({
  revision: z.int().nonnegative(),
  connection: z.object({
    status: z.enum(["disconnected", "connecting", "connected"]),
    device: ConnectedDeviceSchema.nullable(),
    error: z.string().nullable(),
    /** Reset rebooted the machine; the same device is connected again once it answers. */
    restarting: z.boolean(),
  }),
  features: MachineFeaturesSchema.nullable(),
  telemetry: TelemetrySchema.nullable(),
  availability: z.record(AvailabilityKeySchema, AvailabilitySchema),
  activity: ActivitySchema.nullable(),
  deferred: z.array(DeferredOperationSchema),
  job: JobStateSchema.nullable(),
  anchors: z.object({
    value: AnchorConfigurationSchema.nullable(),
    reading: z.boolean(),
    error: z.string().nullable(),
  }),
  /** Set when an outcome is unknown; only Stop is admitted until it clears. */
  lockout: z.object({ reason: z.string() }).nullable(),
  /** The connected machine's control limits; null without one. */
  limits: ControlLimitsSchema.nullable(),
})
export type MachineSnapshot = z.infer<typeof MachineSnapshotSchema>

const unavailable = (reason: string) =>
  Object.fromEntries(
    AVAILABILITY_KEYS.map((key) => [
      key,
      { allowed: false, deferred: false, reason },
    ])
  ) as Record<AvailabilityKey, Availability>

export function disconnectedSnapshot(
  revision = 0,
  reason = "Connect a device first.",
  error: string | null = null
): MachineSnapshot {
  return {
    revision,
    connection: {
      status: "disconnected",
      device: null,
      error,
      restarting: false,
    },
    features: null,
    telemetry: null,
    availability: unavailable(reason),
    activity: null,
    deferred: [],
    job: null,
    anchors: { value: null, reading: false, error: null },
    lockout: null,
    limits: null,
  }
}
