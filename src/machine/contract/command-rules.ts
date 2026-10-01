import { JOB_CONCURRENT_COMMANDS, outsideLimits } from "./commands.ts"
import type { CommandKind, ControlLimits, MachineCommand } from "./commands.ts"
import { isJobActive } from "./job.ts"
import type { JobState } from "./job.ts"
import type { Rule } from "./rules.ts"
import type { Activity, MachineModel } from "./snapshot.ts"
import { isFresh } from "./telemetry.ts"
import type { Telemetry } from "./telemetry.ts"

/** A machine as its firmware identifies it: its model, and whether it changes tools itself. */
export type Identity = {
  readonly model: MachineModel
  readonly atc: boolean
}

/** A firmware's preconditions on the machine's state, which admission consults. */
export interface FirmwareRules {
  /** Whether the machine reports the state this command needs. */
  supports: (
    kind: CommandKind,
    telemetry: Telemetry,
    identity: Identity
  ) => boolean
  /** Machine-state preconditions for a command, or null. */
  command: (command: MachineCommand, telemetry: Telemetry) => string | null
  run: (telemetry: Telemetry) => string | null
  /** Height maps may also be read while a job waits at a program pause. */
  readHeightMap: (telemetry: Telemetry, job: JobState | null) => string | null
}

/** What admission decides about a request: it goes now, waits for the running program, or is refused, and why. */
export type Admission =
  | { readonly verdict: "allow" }
  | { readonly verdict: "defer"; readonly reason: string }
  | { readonly verdict: "refuse"; readonly reason: string }

/** A request admission decides on: a command, or one of the machine's other operations. */
export type AdmissionRequest =
  | { readonly key: CommandKind; readonly command: MachineCommand }
  | {
      readonly key:
        | "run"
        | "readAnchors"
        | "writeAnchors"
        | "readConfiguration"
        | "writeConfiguration"
        | "readHeightMap"
        | "stop"
        | "reset"
        | "console"
    }

/** The machine's state as admission reads it. */
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
  readonly readConfiguration: ((telemetry: Telemetry) => string | null) | null
  readonly writeConfiguration: ((telemetry: Telemetry) => string | null) | null
  /** The ranges the machine's manual controls accept. */
  readonly limits: ControlLimits
}

/** A request to the machine, with the machine's state as admission reads it. */
export type CommandSubject = {
  readonly request: AdmissionRequest
  readonly context: AdmissionContext
}

/** What the command rules test: requests, which they refuse or defer and never fix. */
export type CommandStage = {
  readonly subject: CommandSubject
  readonly fix: never
  readonly details: object
}

/** A rule admission holds a request to. */
export type CommandRule = Rule<"command", CommandStage>

/** Admission's one chain: the first rule a request breaks decides, and the rules after it assume it passed. */
const ADMISSION = "admission"

/** A request for a command, with the command's values. */
type CommandRequest = Extract<AdmissionRequest, { command: MachineCommand }>

const isCommand = (request: AdmissionRequest): request is CommandRequest =>
  "command" in request

/** Why a command's values fall outside the machine's control limits; null for other requests. */
const limitsReason = ({ request, context }: CommandSubject) =>
  isCommand(request) ? outsideLimits(request.command, context.limits) : null

/** Why a streaming program keeps a request from going. */
function runningReason({ request, context }: CommandSubject): string {
  if (request.key === "run") return "A program is already running."
  return isJobActive(context.job)
    ? "Stop the running job before using this control."
    : "The machine is running a program. Stop it before using this control."
}

/** Why the machine's state refuses a request, as the firmware and its anchors say; null without status. */
function stateReason({ request, context }: CommandSubject): string | null {
  const { telemetry } = context
  if (!telemetry) return null
  if (isCommand(request))
    return context.rules.command(request.command, telemetry)
  switch (request.key) {
    case "run":
      return context.rules.run(telemetry)
    case "readAnchors":
      return context.readAnchors?.(telemetry) ?? null
    case "writeAnchors":
      return context.writeAnchors?.(telemetry) ?? null
    case "readConfiguration":
      return context.readConfiguration?.(telemetry) ?? null
    case "writeConfiguration":
      return context.writeConfiguration?.(telemetry) ?? null
    case "readHeightMap":
      return context.rules.readHeightMap(telemetry, context.job)
    // Stop and Reset recover from any machine state; a typed line goes in any machine state,
    // and the firmware answers what it will not run.
    case "stop":
    case "reset":
    case "console":
      return null
  }
}

/** The machine's rules for a request: a chain, whose first failure decides; an error refuses, a warning defers. */
export const COMMAND_RULES: readonly CommandRule[] = [
  {
    id: "machine/connected",
    stage: "command",
    label: "Device connected",
    description: "Every request goes to a connected device.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ context }) => context.connected,
    explain: () => ({ problem: "Connect a device first." }),
  },
  {
    id: "machine/anchors-stored",
    stage: "command",
    label: "Anchors stored",
    description: "Anchors are read from a machine that stores them.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) =>
      request.key !== "readAnchors" || context.readAnchors !== null,
    explain: () => ({ problem: "This machine does not store anchors." }),
  },
  {
    id: "machine/anchors-writable",
    stage: "command",
    label: "Anchors changeable",
    description: "Anchors are changed on a machine that lets them be changed.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) =>
      request.key !== "writeAnchors" || context.writeAnchors !== null,
    explain: () => ({ problem: "This machine's anchors cannot be changed." }),
  },
  {
    id: "machine/configuration-supported",
    stage: "command",
    label: "Configuration available",
    description:
      "The machine must support reading and writing its saved configuration.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) => {
      if (request.key === "readConfiguration")
        return context.readConfiguration !== null
      if (request.key === "writeConfiguration")
        return context.writeConfiguration !== null
      return true
    },
    explain: () => ({
      problem: "This machine does not support a configuration editor.",
    }),
  },
  {
    id: "machine/lockout",
    stage: "command",
    label: "Stop confirmed",
    description:
      "When an outcome is unknown, nothing but Stop goes until a Stop is confirmed or the device is connected again. Not Reset either, whose reconnection would clear the lockout unchecked.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) => request.key === "stop" || !context.lockout,
    explain: ({ first }) => ({ problem: first.context.lockout ?? "" }),
  },
  {
    id: "machine/fresh-status",
    stage: "command",
    label: "Fresh status",
    description:
      "Status older than a few seconds is not trusted for any decision. Stop and Reset do not wait for it.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) =>
      request.key === "stop" ||
      request.key === "reset" ||
      isFresh(context.telemetry, context.now),
    explain: () => ({ problem: "Waiting for fresh device status." }),
  },
  {
    id: "machine/control-limits",
    stage: "command",
    label: "Within control limits",
    description:
      "A command's values stay within the ranges the machine's manual controls accept.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: (subject) => !limitsReason(subject),
    explain: ({ first }) => ({ problem: limitsReason(first) ?? "" }),
  },
  {
    id: "machine/idle",
    stage: "command",
    label: "No operation in progress",
    description:
      "The controller runs one operation at a time; nothing queues. Stop ends it.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) =>
      request.key === "stop" || context.activity === null,
    explain: ({ first }) => ({
      problem: `${first.context.activity?.label ?? "An operation"} is in progress.`,
    }),
  },
  {
    id: "machine/reset-while-running",
    stage: "command",
    label: "No program under Reset",
    description:
      "Reset reboots the controller: it recovers from any machine state, but never under a running program, which Stop ends.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) =>
      request.key !== "reset" || !context.streaming,
    explain: () => ({
      problem: "Stop the running program before resetting the machine.",
    }),
  },
  {
    id: "machine/program-running",
    stage: "command",
    label: "No program running",
    description:
      "While a program streams, only Stop, Reset, reads and the commands a job takes while it runs go. A change to the machine's settings is not put off until later, nor is a typed line.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) => {
      if (!context.streaming) return true
      if (isCommand(request)) return JOB_CONCURRENT_COMMANDS.has(request.key)
      return (
        request.key === "stop" ||
        request.key === "reset" ||
        request.key === "readAnchors" ||
        request.key === "readHeightMap"
      )
    },
    explain: ({ first }) => ({ problem: runningReason(first) }),
  },
  {
    id: "machine/reads-wait",
    stage: "command",
    label: "Reads wait for the program",
    description:
      "A read asked for while a program streams goes when the program ends. A job waiting at a program pause may read the grid it just probed.",
    severity: "warning",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) => {
      if (!context.streaming) return true
      if (request.key === "readAnchors") return false
      if (request.key !== "readHeightMap" || !context.telemetry) return true
      return (
        context.rules.readHeightMap(context.telemetry, context.job) === null
      )
    },
    explain: () => ({ problem: "Reads when the running program ends." }),
  },
  {
    id: "machine/supported",
    stage: "command",
    label: "Reported by the device",
    description:
      "A command goes to a machine that reports the state the command needs.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: ({ request, context }) =>
      !isCommand(request) ||
      !context.identity ||
      !context.telemetry ||
      context.rules.supports(request.key, context.telemetry, context.identity),
    explain: () => ({ problem: "This control is not reported by the device." }),
  },
  {
    id: "machine/state",
    stage: "command",
    label: "Machine state",
    description:
      "Commands, Run and reads go in the machine states the firmware takes them in.",
    severity: "error",
    configurable: false,
    chain: ADMISSION,
    test: (subject) => !stateReason(subject),
    explain: ({ first }) => ({ problem: stateReason(first) ?? "" }),
  },
]
