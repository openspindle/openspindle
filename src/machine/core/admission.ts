import {
  AVAILABILITY_KEYS,
  COMMAND_RULES,
  runRules,
} from "../contract/index.ts"
import type {
  Admission,
  AdmissionContext,
  AdmissionRequest,
  Availability,
  AvailabilityKey,
  ControlLimits,
  Telemetry,
} from "../contract/index.ts"

export type {
  Admission,
  AdmissionContext,
  AdmissionRequest,
} from "../contract/index.ts"

/**
 * What the machine's rules decide about a request: it goes when it breaks none, and otherwise the
 * first it breaks decides, refusing it as an error or deferring it as a warning, for its problem.
 */
export function admit(
  request: AdmissionRequest,
  context: AdmissionContext
): Admission {
  const failure = runRules(COMMAND_RULES, [{ request, context }]).at(0)
  if (!failure) return { verdict: "allow" }
  const reason = failure.rule.explain(failure).problem
  return failure.severity === "error"
    ? { verdict: "refuse", reason }
    : { verdict: "defer", reason }
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
    case "lightBrightness":
      return {
        key,
        command: {
          type: key,
          percent: 100,
          // Availability checks state only; execute validates the actual connection id.
          connectionId: "00000000-0000-4000-8000-000000000000",
        },
      }
    case "lightOffWhenIdle":
      return {
        key,
        command: {
          type: key,
          connectionId: "00000000-0000-4000-8000-000000000000",
        },
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
    case "readConfiguration":
    case "writeConfiguration":
    case "readHeightMap":
    case "readSwitches":
    case "stop":
    case "reset":
    case "console":
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
