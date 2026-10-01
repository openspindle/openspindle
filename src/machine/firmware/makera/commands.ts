import type {
  Axis,
  CommandKind,
  JobState,
  MachineCommand,
  Telemetry,
} from "../../contract/index.ts"
import type { CommandPlan, FirmwareRules, Identity } from "../adapter.ts"
import { FRAME_TYPES } from "./codec.ts"

const MM_PER_INCH = 25.4
const axisKey = (axis: Axis) => axis.toLowerCase() as "x" | "y" | "z"
const decimal = (value: number) => String(Number(value.toFixed(4)))

type PlanOptions = Partial<
  Pick<CommandPlan, "acknowledged" | "timeoutMs" | "motion" | "startsFromAlarm">
>

const command = (
  payload: string,
  verify: CommandPlan["verify"],
  options: PlanOptions = {}
): CommandPlan => ({
  frame: { type: FRAME_TYPES.command, payload },
  acknowledged: options.acknowledged ?? true,
  timeoutMs: options.timeoutMs ?? 8000,
  motion: options.motion ?? false,
  verify,
  ...(options.startsFromAlarm ? { startsFromAlarm: true } : {}),
})

/** SimpleShell, Robot, Player, SpindleControl and Switch handlers, each with its telemetry proof. */
export function planMakeraCommand(
  action: MachineCommand,
  telemetry: Telemetry
): CommandPlan {
  switch (action.type) {
    case "jog": {
      // $J distances follow the controller's unit mode; the UI works in millimetres.
      const distance =
        telemetry.units === "in"
          ? action.distance / MM_PER_INCH
          : action.distance
      const key = axisKey(action.axis)
      return command(
        `$J ${action.axis}${decimal(distance)} F${decimal(action.speedScale)}`,
        (after, before) => {
          const start = before.machine?.[key]
          const end = after.machine?.[key]
          return (
            after.state === "Idle" &&
            start !== undefined &&
            end !== undefined &&
            Math.abs(end - start - action.distance) <=
              Math.min(Math.abs(action.distance) * 0.4, 0.005)
          )
        },
        { acknowledged: false, timeoutMs: 30000, motion: true }
      )
    }
    case "home":
      return command("$H", (after) => after.state === "Idle", {
        timeoutMs: 80000,
        motion: true,
        startsFromAlarm: true,
      })
    case "unlock":
      // Clears the halt ("[Caution: Unlocked]"); a controller that is not halted says nothing.
      return command("$X", (after) => after.state !== "Alarm", {
        startsFromAlarm: true,
      })
    case "zero":
      return command(
        `G10 L20 P0 ${action.axes.map((axis) => `${axis}0`).join(" ")}`,
        (after) =>
          !!after.work &&
          action.axes.every(
            (axis) => Math.abs(after.work![axisKey(axis)]) < 0.001
          )
      )
    case "spindleStart":
      return command(
        `M3 S${action.rpm}`,
        (after) =>
          after.spindleOn === true && after.spindleTargetRpm === action.rpm,
        { motion: true }
      )
    case "spindleStop":
      return command("M5", (after) => after.spindleOn === false, {
        motion: true,
      })
    case "light":
      return command(
        action.enabled ? "M821" : "M822",
        (after) => after.lightOn === action.enabled
      )
    case "lightBrightness":
      // The firmware acknowledges the PWM value; telemetry reports only the light's on state.
      return command(
        `M821 S${Math.round((action.percent * 255) / 100)}`,
        (after) => after.lightOn === true
      )
    case "lightOffWhenIdle":
      return command("M822", (after) => after.lightOn === false)
    case "beep":
      return command(
        action.enabled ? "M861" : "M862",
        (after) => after.beepOn === action.enabled
      )
    case "vacuum":
      return command(
        action.enabled ? "M851 S100" : "M852",
        (after) => after.vacuumOn === action.enabled
      )
    case "vacuumAuto":
      return command(
        action.enabled ? "M331" : "M332",
        (after) => after.vacuumAuto === action.enabled
      )
    case "feedOverride":
      return command(
        `M220 S${action.percent}`,
        (after) => after.feedOverride === action.percent
      )
    case "spindleOverride":
      return command(
        `M223 S${action.percent}`,
        (after) => after.spindleOverride === action.percent
      )
    case "pause":
      // Suspend first finishes queued motion (up to 32 blocks) and any spindle dwell.
      return command("suspend", (after) => after.state === "Pause", {
        acknowledged: false,
        timeoutMs: 80000,
      })
    case "resume":
      return command(
        "resume",
        (after) => after.state === "Run" || after.state === "Idle",
        { acknowledged: false }
      )
    case "confirmToolChange":
      return command(
        "M490.2",
        (after) => ["Idle", "Run", "Home"].includes(after.state),
        { acknowledged: false }
      )
  }
}

const validTool = (tool: number | null) =>
  tool !== null && tool > 0 && tool < 1000
const spindleStopped = (telemetry: Telemetry) =>
  telemetry.spindleOn === false && (telemetry.spindleRpm ?? 0) === 0

/** Machine-state preconditions; connection, freshness, busy and job-stream checks live in the core. */
export const makeraRules: FirmwareRules = {
  supports(kind: CommandKind, telemetry: Telemetry, identity: Identity) {
    switch (kind) {
      case "jog":
        return telemetry.machine !== null
      case "zero":
        return telemetry.work !== null
      case "spindleStart":
      case "spindleStop":
        return telemetry.spindleRpm !== null && telemetry.laserMode !== true
      case "light":
      case "lightBrightness":
        return telemetry.lightOn !== null
      case "lightOffWhenIdle":
        return (
          telemetry.lightOn !== null &&
          telemetry.spindleOn !== null &&
          telemetry.spindleRpm !== null
        )
      case "beep":
        return telemetry.beepOn !== null
      case "vacuum":
        return telemetry.vacuumOn !== null
      case "vacuumAuto":
        return telemetry.vacuumAuto !== null
      case "feedOverride":
        return telemetry.feedOverride !== null
      case "spindleOverride":
        return (
          telemetry.spindleOverride !== null && telemetry.laserMode !== true
        )
      case "confirmToolChange":
        // On ATC machines M490.2 loosens the tool instead of ending a manual change.
        return !identity.atc
      case "home":
      case "unlock":
      case "pause":
      case "resume":
        return true
    }
  },

  command(action, telemetry) {
    const state = telemetry.state
    switch (action.type) {
      case "lightOffWhenIdle":
        if (state !== "Idle" || telemetry.job !== null)
          return "Automatic work light off requires an idle machine with no active program."
        if (telemetry.spindleOn !== false || telemetry.spindleRpm !== 0)
          return "Automatic work light off requires the spindle to be stopped."
        return telemetry.lightOn === true
          ? null
          : "The work light is already off."
      case "lightBrightness":
        if (state !== "Idle" || telemetry.job !== null)
          return "Work light brightness requires an idle machine with no active program."
        return action.onlyIfOn && telemetry.lightOn !== true
          ? "The work light is off."
          : null
      case "light":
      case "beep":
        // A halted controller answers these M-codes with "error:Alarm lock".
        return state === "Alarm"
          ? "Clear the alarm before using this control."
          : null
      case "feedOverride":
      case "spindleOverride":
        if (telemetry.estop === true)
          return "Release the machine emergency stop first."
        return ["Idle", "Run", "Pause"].includes(state)
          ? null
          : "Overrides require an idle, running or paused machine."
      case "pause":
        if (telemetry.estop === true)
          return "Release the machine emergency stop first."
        return state === "Run" && telemetry.job !== null
          ? null
          : "Pause requires a running program."
      case "resume":
        if (telemetry.estop === true)
          return "Release the machine emergency stop first."
        return state === "Pause" ? null : "Resume requires a paused program."
      case "confirmToolChange":
        if (telemetry.estop !== false)
          return "Waiting for the device to report a released emergency stop."
        if (telemetry.spindleOn !== false)
          return "The device must report the spindle stopped first."
        return state === "Tool" && telemetry.spindleRpm === 0
          ? null
          : "Tool confirmation requires a tool-change wait with the spindle stopped."
      case "spindleStop":
        return state === "Idle" ||
          state === "Pause" ||
          (state === "Run" && telemetry.job === null && telemetry.feed === 0)
          ? null
          : "Use Stop to interrupt machine motion."
      case "spindleStart":
        if (telemetry.estop !== false)
          return "Waiting for the device to report a released emergency stop."
        if (!validTool(telemetry.tool))
          return "The device must report a cutting tool before starting the spindle."
        // A running spindle without motion accepts a new target speed.
        if (telemetry.spindleOn === true)
          return state === "Run" &&
            telemetry.job === null &&
            telemetry.feed === 0
            ? null
            : "Change the speed while the spindle runs without motion."
        if (telemetry.spindleOn !== false)
          return "Waiting for the device to report the spindle state."
        return state === "Idle"
          ? null
          : "This control requires an idle machine."
      case "unlock":
        if (telemetry.estop === true)
          return "Release the machine emergency stop first."
        return state === "Alarm"
          ? null
          : "Unlock clears an alarm; the machine is not in one."
      case "home":
        if (telemetry.estop !== false)
          return "Waiting for the device to report a released emergency stop."
        return (state === "Idle" || state === "Alarm") &&
          spindleStopped(telemetry)
          ? null
          : "Homing requires an idle machine with the spindle stopped."
      case "jog":
      case "zero":
        if (telemetry.estop !== false)
          return "Waiting for the device to report a released emergency stop."
        if (telemetry.spindleOn !== false)
          return "The device must report the spindle stopped first."
        return state === "Idle"
          ? null
          : "This control requires an idle machine."
      case "vacuum":
      case "vacuumAuto":
        if (telemetry.estop === true)
          return "Release the machine emergency stop first."
        return state === "Idle"
          ? null
          : "This control requires an idle machine."
    }
  },

  run(telemetry) {
    if (telemetry.state !== "Idle" || telemetry.job !== null)
      return "Run requires an idle machine with no active program."
    if (telemetry.estop !== false)
      return "The device must report a released emergency stop before Run."
    if (!spindleStopped(telemetry) || telemetry.spindleRpm !== 0)
      return "Stop the spindle before starting a program."
    if (telemetry.laserMode !== false)
      return "Run requires the device to report milling mode."
    if (telemetry.bedCleanAuto === null)
      return "The device does not report its bed-clean mode; job completion cannot be verified."
    return null
  },

  readHeightMap(telemetry, job: JobState | null) {
    if (job?.wait?.reason === "program-pause" && telemetry.state === "Pause")
      return null
    return telemetry.state === "Idle" && telemetry.job === null
      ? null
      : "The device must be idle, or paused at a program pause."
  },
}
