import { z } from "zod"
import { AxisSchema } from "./telemetry.ts"

/**
 * The ranges a machine's manual controls accept, which its firmware adapter declares:
 * application limits, not a claim about the machine's maximum rating. Commands are held to the
 * connected machine's limits when they are admitted (`outsideLimits`).
 */
export const ControlLimitsSchema = z.object({
  jogMinDistance: z.number(),
  jogMaxDistance: z.number(),
  /** Jog speeds are shares of the machine's maximum. */
  jogMinSpeedScale: z.number(),
  jogMaxSpeedScale: z.number(),
  spindleRpmMin: z.number(),
  spindleRpmMax: z.number(),
  /** Feed and spindle overrides, in percent. */
  overrideMin: z.number(),
  overrideMax: z.number(),
})
export type ControlLimits = z.infer<typeof ControlLimitsSchema>

const toggle = <TType extends string>(type: TType) =>
  z.strictObject({ type: z.literal(type), enabled: z.boolean() })
const override = <TType extends string>(type: TType) =>
  z.strictObject({
    type: z.literal(type),
    percent: z.int().positive("Override must be a whole percentage."),
  })
const bare = <TType extends string>(type: TType) =>
  z.strictObject({ type: z.literal(type) })

/**
 * Closed command set. A line typed in the console is its own request (`ConsoleLineSchema`),
 * admitted like these and held to the machine's program rules, and Stop is its own procedure.
 */
export const MachineCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("jog"),
    axis: AxisSchema,
    distance: z
      .number()
      .refine((distance) => distance !== 0, "Jog distance must not be 0."),
    speedScale: z
      .number()
      .positive()
      .max(1, "Jog speed is a share of the maximum, at most 1."),
  }),
  bare("home"),
  bare("unlock"),
  z.strictObject({
    type: z.literal("zero"),
    axes: z
      .array(AxisSchema)
      .min(1)
      .max(3)
      .refine(
        (axes) => new Set(axes).size === axes.length,
        "Choose unique axes to zero."
      ),
  }),
  z.strictObject({
    type: z.literal("spindleStart"),
    rpm: z.int().positive("Spindle target must be a whole number of RPM."),
  }),
  bare("spindleStop"),
  toggle("light"),
  toggle("beep"),
  toggle("vacuum"),
  toggle("vacuumAuto"),
  override("feedOverride"),
  override("spindleOverride"),
  bare("pause"),
  bare("resume"),
  bare("confirmToolChange"),
])
export type MachineCommand = z.infer<typeof MachineCommandSchema>

const percent = (share: number) => Number((share * 100).toFixed(6))
const rpm = (value: number) => value.toLocaleString("en-US")

/** Why a command's values fall outside a machine's control limits; null when they are within. */
export function outsideLimits(
  command: MachineCommand,
  limits: ControlLimits
): string | null {
  switch (command.type) {
    case "jog": {
      const distance = Math.abs(command.distance)
      if (distance < limits.jogMinDistance || distance > limits.jogMaxDistance)
        return `Jog distance must be ${limits.jogMinDistance}–${limits.jogMaxDistance} mm.`
      if (
        command.speedScale < limits.jogMinSpeedScale ||
        command.speedScale > limits.jogMaxSpeedScale
      )
        return `Jog speed must be ${percent(limits.jogMinSpeedScale)}–${percent(limits.jogMaxSpeedScale)}%.`
      return null
    }
    case "spindleStart":
      if (
        command.rpm < limits.spindleRpmMin ||
        command.rpm > limits.spindleRpmMax
      )
        return `Spindle target must be an integer from ${rpm(limits.spindleRpmMin)} to ${rpm(limits.spindleRpmMax)} RPM.`
      return null
    case "feedOverride":
    case "spindleOverride":
      if (
        command.percent < limits.overrideMin ||
        command.percent > limits.overrideMax
      )
        return `Override must be an integer from ${limits.overrideMin} to ${limits.overrideMax} percent.`
      return null
    default:
      return null
  }
}
export type CommandKind = MachineCommand["type"]
export type CommandOf<TKind extends CommandKind> = Extract<
  MachineCommand,
  { type: TKind }
>

export const COMMAND_KINDS = [
  "jog",
  "home",
  "unlock",
  "zero",
  "spindleStart",
  "spindleStop",
  "light",
  "beep",
  "vacuum",
  "vacuumAuto",
  "feedOverride",
  "spindleOverride",
  "pause",
  "resume",
  "confirmToolChange",
] as const satisfies readonly CommandKind[]

/** Admitted while a program streams; verified by telemetry only, never by acknowledgements. */
export const JOB_CONCURRENT_COMMANDS: ReadonlySet<CommandKind> = new Set([
  "light",
  "beep",
  "feedOverride",
  "spindleOverride",
  "pause",
  "resume",
  "confirmToolChange",
])

export const COMMAND_LABELS: Record<CommandKind, string> = {
  jog: "Jog",
  home: "Home",
  unlock: "Unlock",
  zero: "Set work zero",
  spindleStart: "Start spindle",
  spindleStop: "Stop spindle",
  light: "Work light",
  beep: "Beep",
  vacuum: "Vacuum",
  vacuumAuto: "Vacuum follows spindle",
  feedOverride: "Feed override",
  spindleOverride: "Spindle override",
  pause: "Pause",
  resume: "Resume",
  confirmToolChange: "Tool installed",
}
