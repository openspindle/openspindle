import { z } from "zod"

export const MACHINE_STATES = [
  "Idle",
  "Run",
  "Home",
  "Hold",
  "Pause",
  "Wait",
  "Tool",
  "Alarm",
  "Sleep",
] as const
export const MachineStateSchema = z.enum(MACHINE_STATES)
export type MachineState = z.infer<typeof MachineStateSchema>

export const AXES = ["X", "Y", "Z"] as const
export const AxisSchema = z.enum(AXES)
export type Axis = z.infer<typeof AxisSchema>

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  a: z.number().nullable(),
  b: z.number().nullable(),
})
export type Position = z.infer<typeof PositionSchema>

/** Player progress as the firmware reports it; the percentage is rounded by the firmware. */
export const JobProgressSchema = z.object({
  line: z.number().int().nonnegative(),
  percent: z.number().min(0).max(100),
  elapsedSeconds: z.number().nonnegative(),
})
export type JobProgress = z.infer<typeof JobProgressSchema>

const reading = z.number().nullable()
const flag = z.boolean().nullable()

/** Firmware-reported machine state. Missing reports stay null and are never estimated. */
export const TelemetrySchema = z.object({
  receivedAt: z.number(),
  state: MachineStateSchema,
  units: z.enum(["mm", "in"]),
  absolute: z.boolean(),
  machine: PositionSchema.nullable(),
  work: PositionSchema.nullable(),
  /**
   * Where work zero is in machine coordinates, as the machine keeps it: the active work
   * coordinate system's offset (with any G92 shift), from the machine and work positions and
   * the tool offset. Null while any of them is unknown.
   */
  workOrigin: PositionSchema.nullable(),
  feed: reading,
  requestedFeed: reading,
  feedOverride: reading,
  spindleRpm: reading,
  spindleTargetRpm: reading,
  spindleOverride: reading,
  spindleTemperature: reading,
  controllerTemperature: reading,
  spindleOn: flag,
  tool: reading,
  /** The tool's length offset from the tool work Z was set with, in millimetres. */
  toolOffset: reading,
  /** The tool a manual tool change is waiting for. */
  requestedTool: reading,
  laserMode: flag,
  vacuumAuto: flag,
  blowingAuto: flag,
  bedCleanAuto: flag,
  antiStatic: flag,
  lightOn: flag,
  beepOn: flag,
  /** The external extractor output; not the controller's power fan. */
  vacuumOn: flag,
  vacuumPower: reading,
  job: JobProgressSchema.nullable(),
  /** Halt reason while the controller is halted. */
  alarm: reading,
  estop: flag,
  /** Maximum height-map deviation while compensation is active. */
  compensation: reading,
})
export type Telemetry = z.infer<typeof TelemetrySchema>

/** Status older than this is not trusted for any decision. */
export const TELEMETRY_FRESH_MS = 5000

export const isFresh = (
  telemetry: Telemetry | null | undefined,
  now: number
): telemetry is Telemetry =>
  !!telemetry &&
  now - telemetry.receivedAt <= TELEMETRY_FRESH_MS &&
  telemetry.receivedAt <= now + 1000
