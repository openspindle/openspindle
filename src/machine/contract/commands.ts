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

/** Where a go-to move ends in X and Y. */
export const GoToTargetSchema = z.enum([
  "clearance",
  "origin",
  "anchor1",
  "anchor2",
])
export type GoToTarget = z.infer<typeof GoToTargetSchema>

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
  /**
   * Sets where the tool is to `position` in work coordinates on `axis`, mm: zeroing is the same
   * at 0 (`zero`). Z also takes the tool now in the spindle as the one later lengths are from.
   */
  z.strictObject({
    type: z.literal("setWork"),
    axis: AxisSchema,
    position: z.number().min(-10000).max(10000),
  }),
  /**
   * Up to the clearance height, then over to `target` in X and Y: the clearance position, work
   * X0 Y0, or one of the anchors, where the machine keeps them.
   */
  z.strictObject({
    type: z.literal("goTo"),
    target: GoToTargetSchema,
  }),
  z.strictObject({
    type: z.literal("spindleStart"),
    rpm: z.int().positive("Spindle target must be a whole number of RPM."),
  }),
  bare("spindleStop"),
  toggle("light"),
  z.strictObject({
    type: z.literal("lightBrightness"),
    percent: z.int().min(1).max(100),
    connectionId: z.string().uuid(),
    /** Automatic synchronization must not turn a light back on after it was switched off. */
    onlyIfOn: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal("lightOffWhenIdle"),
    connectionId: z.string().uuid(),
  }),
  toggle("beep"),
  toggle("vacuum"),
  toggle("vacuumAuto"),
  override("feedOverride"),
  override("spindleOverride"),
  bare("pause"),
  bare("resume"),
  bare("confirmToolChange"),
  /** Stops applying the height map the machine probed last. */
  bare("clearHeightMap"),
  /**
   * Tells the machine which tool its spindle holds, -1 for none, without changing or measuring
   * it: its tool offset stays.
   */
  z.strictObject({
    type: z.literal("setTool"),
    tool: z.int().min(-1).max(999999),
  }),
  /**
   * The machine's own tool change to `tool`: it waits for the tool to be installed
   * (`confirmToolChange`), then measures it. A change to the tool it holds changes nothing.
   */
  z.strictObject({
    type: z.literal("changeTool"),
    tool: z.int().min(0).max(999999),
  }),
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
  "setWork",
  "goTo",
  "spindleStart",
  "spindleStop",
  "light",
  "lightBrightness",
  "lightOffWhenIdle",
  "beep",
  "vacuum",
  "vacuumAuto",
  "feedOverride",
  "spindleOverride",
  "pause",
  "resume",
  "confirmToolChange",
  "clearHeightMap",
  "setTool",
  "changeTool",
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
  setWork: "Set work position",
  goTo: "Go to",
  spindleStart: "Start spindle",
  spindleStop: "Stop spindle",
  light: "Work light",
  lightBrightness: "Work light brightness",
  lightOffWhenIdle: "Automatic work light off",
  beep: "Beep",
  vacuum: "Vacuum",
  vacuumAuto: "Vacuum follows spindle",
  feedOverride: "Feed override",
  spindleOverride: "Spindle override",
  pause: "Pause",
  resume: "Resume",
  confirmToolChange: "Tool installed",
  clearHeightMap: "Clear height map",
  setTool: "Set tool",
  changeTool: "Change tool",
}
