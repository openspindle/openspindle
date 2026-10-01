import { z } from "zod"
import {
  AnchorConfigurationSchema,
  ConnectRequestSchema,
  ConsoleLineSchema,
  SimulatedBedSchema,
  ConsoleEntrySchema,
  DisconnectRequestSchema,
  HeightMapSchema,
  MachineCommandSchema,
  MachineSnapshotSchema,
  NetworkDeviceSchema,
  PrepareResultSchema,
  RunRequestSchema,
  WriteAnchorsRequestSchema,
  WriteAnchorsResultSchema,
} from "../../machine/contract/index.ts"

export const CameraEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("status"),
    status: z.enum(["connecting", "live", "error"]),
  }),
  z.object({
    kind: z.literal("frame"),
    jpeg: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
    receivedAt: z.number(),
  }),
])
export type CameraEvent = z.infer<typeof CameraEventSchema>

const none = z.undefined()

/** The machine surface the main process serves to the app renderer. */
export const machineMethods = {
  "machine.snapshot": {
    params: none,
    result: MachineSnapshotSchema,
    timeoutMs: 15_000,
  },
  "machine.discover": {
    params: none,
    result: z.array(NetworkDeviceSchema),
    timeoutMs: 15_000,
  },
  "machine.connect": {
    params: ConnectRequestSchema,
    result: MachineSnapshotSchema,
    timeoutMs: 20_000,
  },
  "machine.disconnect": {
    params: DisconnectRequestSchema,
    result: MachineSnapshotSchema,
    timeoutMs: 15_000,
  },
  "machine.execute": {
    params: MachineCommandSchema,
    result: MachineSnapshotSchema,
    timeoutMs: 120_000,
  },
  "machine.simulateBed": {
    params: SimulatedBedSchema,
    result: MachineSnapshotSchema,
    timeoutMs: 30_000,
  },
  "machine.sendConsoleLine": {
    params: z.object({ line: ConsoleLineSchema }),
    result: MachineSnapshotSchema,
    timeoutMs: 30_000,
  },
  // Never refused for the in-flight budget: Stop goes through however many calls wait.
  "machine.stop": {
    params: none,
    result: MachineSnapshotSchema,
    timeoutMs: 20_000,
    budget: null,
  },
  // Returns once the reset is sent; reconnecting shows in later snapshots.
  "machine.reset": {
    params: none,
    result: MachineSnapshotSchema,
    timeoutMs: 20_000,
  },
  "machine.prepare": {
    params: z.strictObject({ source: z.string() }),
    result: PrepareResultSchema,
    timeoutMs: 30_000,
  },
  // Returns once the first part plays: every part is sent before, each within the
  // controller's own deadline.
  "machine.run": {
    params: RunRequestSchema,
    result: MachineSnapshotSchema,
    timeoutMs: 1_200_000,
  },
  "machine.dismissJob": {
    params: none,
    result: MachineSnapshotSchema,
    timeoutMs: 15_000,
  },
  // Reads may wait for a running program to end; callers cancel instead of timing out.
  "machine.readAnchors": {
    params: none,
    result: AnchorConfigurationSchema,
    timeoutMs: 0,
  },
  "machine.readHeightMap": {
    params: none,
    result: HeightMapSchema,
    timeoutMs: 0,
  },
  // Each setting, then each read back, within the controller's own deadlines.
  "machine.writeAnchors": {
    params: WriteAnchorsRequestSchema,
    result: WriteAnchorsResultSchema,
    timeoutMs: 120_000,
  },
} as const

export const machineEvents = {
  "machine.changed": { params: none, data: MachineSnapshotSchema },
  "machine.camera": { params: none, data: CameraEventSchema },
  /** The console's backlog first, then new entries in batches. */
  "machine.console": { params: none, data: z.array(ConsoleEntrySchema) },
} as const
