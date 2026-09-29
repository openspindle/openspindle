import {
  AVAILABILITY_KEYS,
  JOB_CONCURRENT_COMMANDS,
  isFresh,
  isJobActive,
  outsideLimits,
} from "../contract/index.ts"
import type {
  Activity,
  Availability,
  AvailabilityKey,
  CommandKind,
  ControlLimits,
  JobState,
  MachineCommand,
  Telemetry,
} from "../contract/index.ts"
import type { FirmwareRules, Identity } from "../firmware/adapter.ts"

export type Admission =
  | { readonly verdict: "allow" }
  | { readonly verdict: "defer"; readonly reason: string }
  | { readonly verdict: "refuse"; readonly reason: string }

export type AdmissionRequest =
  | { readonly key: CommandKind; readonly command: MachineCommand }
  | {
      readonly key:
        | "run"
        | "readAnchors"
        | "writeAnchors"
        | "readHeightMap"
        | "stop"
        | "reset"
    }

export type AdmissionContext = {
  readonly connected: boolean
  readonly identity: Identity | null
  readonly telemetry: Telemetry | null
  readonly now: number
  readonly activity: Activity | null
  readonly lockout: string | null
  /** A program streams: our job is active, or the machine reports player progress. */
  readonly streaming: boolean
  readonly job: JobState | null
  readonly rules: FirmwareRules
  /** Machine-state preconditions for reading stored anchors; null when the machine stores none. */
  readonly readAnchors: ((telemetry: Telemetry) => string | null) | null
  /** Machine-state preconditions for changing them; null when they cannot be changed. */
  readonly writeAnchors: ((telemetry: Telemetry) => string | null) | null
  /** The ranges the machine's manual controls accept. */
  readonly limits: ControlLimits
}

type Rule = (
  request: AdmissionRequest,
  context: AdmissionContext,
  telemetry: Telemetry
) => Admission | null

const refuse = (reason: string): Admission => ({ verdict: "refuse", reason })
const ALLOW: Admission = { verdict: "allow" }

const isCommand = (
  request: AdmissionRequest
): request is Extract<AdmissionRequest, { command: MachineCommand }> =>
  "command" in request

/** Chain of Responsibility: the first rule with a verdict decides. */
const RULES: readonly Rule[] = [
  function limits(request, context) {
    if (!isCommand(request)) return null
    const reason = outsideLimits(request.command, context.limits)
    return reason ? refuse(reason) : null
  },
  function busy(_request, context) {
    return context.activity
      ? refuse(`${context.activity.label} is in progress.`)
      : null
  },
  function streaming(request, context, telemetry) {
    if (!context.streaming) return null
    const running = isJobActive(context.job)
      ? "Stop the running job before using this control."
      : "The machine is running a program. Stop it before using this control."
    if (isCommand(request))
      return JOB_CONCURRENT_COMMANDS.has(request.key) ? null : refuse(running)
    switch (request.key) {
      case "run":
        return refuse("A program is already running.")
      // A change to the machine's settings is not put off until later.
      case "writeAnchors":
        return refuse(running)
      case "readHeightMap":
        // A job waiting at a program pause may read the grid it just probed.
        if (context.rules.readHeightMap(telemetry, context.job) === null)
          return null
        return {
          verdict: "defer",
          reason: "Reads when the running program ends.",
        }
      default:
        return {
          verdict: "defer",
          reason: "Reads when the running program ends.",
        }
    }
  },
  function capability(request, context, telemetry) {
    if (!isCommand(request) || !context.identity) return null
    return context.rules.supports(request.key, telemetry, context.identity)
      ? null
      : refuse("This control is not reported by the device.")
  },
  function machineState(request, context, telemetry) {
    let reason: string | null
    if (isCommand(request))
      reason = context.rules.command(request.command, telemetry)
    else if (request.key === "run") reason = context.rules.run(telemetry)
    else if (request.key === "readAnchors")
      reason = context.readAnchors?.(telemetry) ?? null
    else if (request.key === "writeAnchors")
      reason = context.writeAnchors?.(telemetry) ?? null
    else reason = context.rules.readHeightMap(telemetry, context.job)
    return reason ? refuse(reason) : null
  },
]

export function admit(
  request: AdmissionRequest,
  context: AdmissionContext
): Admission {
  if (!context.connected) return refuse("Connect a device first.")
  if (request.key === "readAnchors" && !context.readAnchors)
    return refuse("This machine does not store anchors.")
  if (request.key === "writeAnchors" && !context.writeAnchors)
    return refuse("This machine's anchors cannot be changed.")
  // Stop needs nothing but a connection.
  if (request.key === "stop") return ALLOW
  // An outcome is unknown: nothing but Stop until a Stop is confirmed or the device is connected
  // again. Not Reset either, whose reconnection would clear the lockout unchecked.
  if (context.lockout) return refuse(context.lockout)
  // Reset reboots the controller: it recovers from any machine state, but never under a
  // running program or an operation (Stop ends those).
  if (request.key === "reset") {
    if (context.activity)
      return refuse(`${context.activity.label} is in progress.`)
    return context.streaming
      ? refuse("Stop the running program before resetting the machine.")
      : ALLOW
  }
  const telemetry = context.telemetry
  if (!isFresh(telemetry, context.now))
    return refuse("Waiting for fresh device status.")
  for (const rule of RULES) {
    const verdict = rule(request, context, telemetry)
    if (verdict) return verdict
  }
  return ALLOW
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * The representative request behind each availability entry (toggles flip the reported state),
 * within the machine's control limits, so availability tells its state.
 */
function representative(
  key: AvailabilityKey,
  telemetry: Telemetry | null,
  limits: ControlLimits
): AdmissionRequest {
  switch (key) {
    case "jog":
      return {
        key,
        command: {
          type: key,
          axis: "X",
          distance: clamp(1, limits.jogMinDistance, limits.jogMaxDistance),
          speedScale: clamp(
            0.1,
            limits.jogMinSpeedScale,
            limits.jogMaxSpeedScale
          ),
        },
      }
    case "zero":
      return { key, command: { type: key, axes: ["X"] } }
    case "spindleStart":
      return {
        key,
        command: {
          type: key,
          rpm: clamp(
            telemetry?.spindleTargetRpm || limits.spindleRpmMax,
            limits.spindleRpmMin,
            limits.spindleRpmMax
          ),
        },
      }
    case "light":
      return {
        key,
        command: { type: key, enabled: telemetry?.lightOn !== true },
      }
    case "beep":
      return {
        key,
        command: { type: key, enabled: telemetry?.beepOn !== true },
      }
    case "vacuum":
      return {
        key,
        command: { type: key, enabled: telemetry?.vacuumOn !== true },
      }
    case "vacuumAuto":
      return {
        key,
        command: { type: key, enabled: telemetry?.vacuumAuto !== true },
      }
    case "feedOverride":
    case "spindleOverride":
      return {
        key,
        command: {
          type: key,
          percent: clamp(100, limits.overrideMin, limits.overrideMax),
        },
      }
    case "home":
    case "unlock":
    case "spindleStop":
    case "pause":
    case "resume":
    case "confirmToolChange":
      return { key, command: { type: key } }
    case "run":
    case "readAnchors":
    case "writeAnchors":
    case "readHeightMap":
    case "stop":
    case "reset":
      return { key }
  }
}

const toAvailability = (admission: Admission): Availability => {
  switch (admission.verdict) {
    case "allow":
      return { allowed: true, deferred: false, reason: null }
    case "defer":
      return { allowed: true, deferred: true, reason: admission.reason }
    case "refuse":
      return { allowed: false, deferred: false, reason: admission.reason }
  }
}

export function availability(
  context: AdmissionContext
): Record<AvailabilityKey, Availability> {
  return Object.fromEntries(
    AVAILABILITY_KEYS.map((key) => [
      key,
      toAvailability(
        admit(representative(key, context.telemetry, context.limits), context)
      ),
    ])
  ) as Record<AvailabilityKey, Availability>
}
