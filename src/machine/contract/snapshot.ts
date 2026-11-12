import { z } from "zod"
import { ProbeCheckSchema } from "./probe-check.ts"
import { AnchorConfigurationSchema } from "./anchors.ts"
import { COMMAND_KINDS, ControlLimitsSchema } from "./commands.ts"
import { JobStateSchema } from "./job.ts"
import { DisplayNameSchema, LocalIPv4Schema, PortSchema } from "./primitives.ts"
import { TelemetrySchema } from "./telemetry.ts"

/** The machine's model, as its firmware adapter names it; fixture kits are made for models. */
export const MachineModelSchema = DisplayNameSchema
export type MachineModel = z.infer<typeof MachineModelSchema>

export const TcpTargetSchema = z.strictObject({
  transport: z.literal("tcp").optional(),
  host: LocalIPv4Schema,
  port: PortSchema,
  name: DisplayNameSchema.optional(),
})
export const SerialTargetSchema = z.strictObject({
  transport: z.literal("serial"),
  portId: z.string().regex(/^usb(?:-path)?:[a-f0-9:]{64,90}$/),
  pathHint: z.string().min(1).max(512).optional(),
  name: DisplayNameSchema.optional(),
  cameraHost: LocalIPv4Schema.optional(),
  /** Explicit association; a model mismatch fails the identity handshake. */
  profile: z
    .object({
      id: DisplayNameSchema,
      model: MachineModelSchema,
      name: DisplayNameSchema,
    })
    .optional(),
})
export const ConnectTargetSchema = z.union([
  TcpTargetSchema,
  SerialTargetSchema,
])
export type ConnectTarget = z.infer<typeof ConnectTargetSchema>
export type SerialTarget = z.infer<typeof SerialTargetSchema>
const confirmation = { confirmed: z.boolean().optional() }
export const ConnectRequestSchema = z.union([
  TcpTargetSchema.extend(confirmation),
  SerialTargetSchema.extend(confirmation),
])
export type ConnectRequest = z.infer<typeof ConnectRequestSchema>

export const SerialDeviceSchema = z.object({
  id: z.string().min(1).max(100),
  path: z.string().min(1).max(512),
  manufacturer: z.string().max(200),
  vendorId: z.string().max(8),
  productId: z.string().max(8),
  stable: z.boolean(),
})
export type SerialDevice = z.infer<typeof SerialDeviceSchema>

export const DisconnectRequestSchema = z.strictObject({
  confirmed: z.boolean().optional(),
})
export type DisconnectRequest = z.infer<typeof DisconnectRequestSchema>

export const NetworkDeviceSchema = z.object({
  name: DisplayNameSchema,
  host: LocalIPv4Schema,
  port: PortSchema,
  busy: z.boolean(),
})
export type NetworkDevice = z.infer<typeof NetworkDeviceSchema>

export const ConnectedDeviceSchema = z.union([
  z.object({
    transport: z.literal("tcp").optional(),
    name: DisplayNameSchema,
    host: LocalIPv4Schema,
    port: PortSchema,
    model: MachineModelSchema,
  }),
  SerialTargetSchema.omit({ profile: true }).extend({
    name: DisplayNameSchema,
    model: MachineModelSchema,
    profileId: DisplayNameSchema.optional(),
  }),
])
export type ConnectedDevice = z.infer<typeof ConnectedDeviceSchema>

/** Persistent physical identity, independent of the changing serial device path. */
export const machineId = (
  device: Pick<ConnectedDevice, "model" | "name"> & {
    transport?: "tcp" | "serial"
    portId?: string
    profileId?: string
  }
) => {
  if (device.transport === "serial")
    return device.profileId ?? `${device.model}:USB:${device.portId}`
  return `${device.model}:${device.name}`
}
export function endpointLabel(target: ConnectTarget | ConnectedDevice) {
  if (target.transport === "serial")
    return target.pathHint ? `USB · ${target.pathHint}` : "USB serial"
  return `${target.host}:${target.port}`
}
function associatedProfile(target: ConnectTarget | ConnectedDevice) {
  if ("profile" in target) return target.profile?.id
  if ("profileId" in target) return target.profileId
  return undefined
}
export function sameEndpoint(
  a: ConnectTarget | ConnectedDevice,
  b: ConnectTarget | ConnectedDevice
) {
  if (a.transport === "serial" || b.transport === "serial")
    return (
      a.transport === "serial" &&
      b.transport === "serial" &&
      a.portId === b.portId &&
      a.cameraHost === b.cameraHost &&
      associatedProfile(a) === associatedProfile(b)
    )
  return a.host === b.host && a.port === b.port
}
export const MachineFeaturesSchema = z.object({
  /** Automatic tool changer; manual machines wait in Tool state instead. */
  atc: z.boolean(),
  camera: z.boolean(),
  bedClean: z.boolean(),
  /** Stored anchors, which stock, fixtures and the work origin can be kept relative to. */
  anchors: z.boolean(),
  configuration: z.boolean(),
})
export type MachineFeatures = z.infer<typeof MachineFeaturesSchema>

export const AVAILABILITY_KEYS = [
  ...COMMAND_KINDS,
  "run",
  "readAnchors",
  "writeAnchors",
  "readConfiguration",
  "writeConfiguration",
  "readHeightMap",
  /** The machine's switches, as diagnosis inspects them. */
  "readSwitches",
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
  "configuration",
  "inspection",
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
  probeCheck: ProbeCheckSchema.nullable().optional(),
  simulatorController: z.object({
    targetRpm: z.number().nullable().optional(),
    arm: AvailabilitySchema,
    step: AvailabilitySchema,
    spindle: AvailabilitySchema,
  }),
  connection: z.object({
    /** Changes on every connection, even to the same network address. */
    id: z.string().uuid().nullable(),
    status: z.enum(["disconnected", "connecting", "connected"]),
    /** TCP may stay open while firmware status is unavailable. */
    health: z.enum(["waiting", "fresh", "stale"]),
    device: ConnectedDeviceSchema.nullable(),
    error: z.string().nullable(),
    /** Reset rebooted the machine; the same device is connected again once it answers. */
    restarting: z.boolean(),
    /**
     * Settings were saved on the machine over this connection that it applies only once it
     * restarts. A new connection, as after Reset, starts without them.
     */
    restartNeeded: z.boolean(),
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
    probeCheck: null,
    simulatorController: {
      arm: { allowed: false, deferred: false, reason },
      step: { allowed: false, deferred: false, reason },
      spindle: { allowed: false, deferred: false, reason },
    },
    connection: {
      id: null,
      status: "disconnected",
      health: "waiting",
      device: null,
      error,
      restarting: false,
      restartNeeded: false,
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
