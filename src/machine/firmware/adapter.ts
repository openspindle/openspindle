import type {
  AnchorConfiguration,
  AnchorPosition,
  AssistKey,
  CommandKind,
  ConnectedDevice,
  ControlLimits,
  HeightMap,
  JobFault,
  JobMeasurement,
  JobPhase,
  JobState,
  JobWait,
  MachineCommand,
  MachineFeatures,
  MachineModel,
  NetworkDevice,
  PlateAssists,
  PreparedProgram,
  Telemetry,
} from "../contract/index.ts"

export type InboundFrame = {
  readonly type: number
  readonly payload: Uint8Array
}
export type OutboundFrame = {
  readonly type: number
  readonly payload: Uint8Array | string
}

/** How the core treats a text line, independent of which operation is waiting. */
export type LineKind =
  /** Command acknowledgement. While a program streams these belong to played lines. */
  | "ack"
  /** An error report from a command or a played line. */
  | "error"
  /** A console command refused (for example "Not suspended"). */
  | "rejection"
  | "alarm"
  /** Controller halted, or playback aborted by a halt. */
  | "halt"
  /** Playback aborted without a halt. */
  | "abort"
  /** Tool-change or bed-cleaning automation finished. */
  | "automation-done"
  /** Probing or file failure while a program plays. */
  | "job-fault"
  | "info"

export type Line = { readonly text: string; readonly kind: LineKind }

/** Kinds that report a failure of whatever the machine was just asked to do. */
export const FAILURE_LINES: ReadonlySet<LineKind> = new Set([
  "error",
  "rejection",
  "alarm",
  "halt",
  "abort",
  "job-fault",
])

/** Device text quoted in a user-facing message. */
export const excerpt = (text: string) =>
  text.length > 240 ? `${text.slice(0, 239)}…` : text

export type Identity = {
  readonly model: MachineModel
  readonly atc: boolean
}

export type FirmwareEvent =
  | {
      readonly kind: "status"
      readonly telemetry: Telemetry
      /** Status frames identify the machine on every report. */
      readonly identity: Identity
      /** The report as the device sent it, for the protocol trace. */
      readonly raw: string
    }
  | { readonly kind: "identity"; readonly identity: Identity }
  | { readonly kind: "line"; readonly line: Line }
  /** Configuration text (a separate channel from command replies). */
  | { readonly kind: "config-line"; readonly text: string }
  | { readonly kind: "config-error" }
  | { readonly kind: "transfer"; readonly frame: InboundFrame }

/** Per-connection decoder: frames, text assembly and diagnostics merging. */
export interface FirmwareInterpreter {
  /** Throws a ProtocolError when the stream is corrupt; the session then closes. */
  push: (chunk: Uint8Array, now: number) => FirmwareEvent[]
}

export class ProtocolError extends Error {}

/** A program the dialect cannot transfer as-is. */
export class ProgramError extends Error {
  readonly line: number | null
  constructor(message: string, line: number | null = null) {
    super(message)
    this.line = line
  }
}

export type CommandPlan = {
  readonly frame: OutboundFrame
  /** The firmware answers with an acknowledgement line (never trusted while a program streams). */
  readonly acknowledged: boolean
  readonly timeoutMs: number
  /** Unverified motion leaves the machine state unknown; the session closes. */
  readonly motion: boolean
  /** Homing starts from Alarm: Alarm before the acknowledgement is not a failure. */
  readonly startsFromAlarm?: boolean
  /** The telemetry post-condition that proves the command took effect. */
  readonly verify: (after: Telemetry, before: Telemetry) => boolean
}

/** A setting sent before play: acknowledged, then confirmed by a newer status. */
export type SettingStep = {
  readonly frame: OutboundFrame
  readonly applied: (telemetry: Telemetry) => boolean
}

export type AssistStep = SettingStep & {
  readonly key: AssistKey
  readonly enabled: boolean
}

/** Upload and readback of one program file; pure bookkeeping, the runner owns timing. */
export interface TransferProtocol {
  readonly totalBytes: number
  readonly uploadedBytes: number
  readonly verifiedBytes: number
  readonly stage: "upload" | "readback" | "done"
  /** Done, and the device acknowledged the end: its file is closed and another may follow. */
  readonly finished: boolean
  start: () => OutboundFrame[]
  /** Returns frames to send, or throws a TransferError. */
  receive: (frame: InboundFrame) => OutboundFrame[]
  /** Frames that abandon an in-flight transfer. */
  cancel: () => OutboundFrame[]
}

export class TransferError extends Error {}

export type CompletionUpdate = {
  readonly phase: JobPhase
  readonly progress: Telemetry["job"]
  readonly wait: JobWait | null
  readonly faults: readonly JobFault[]
  readonly measurements: readonly JobMeasurement[]
  readonly overdue: boolean
  readonly error: string | null
  /** The file playing is about to end: status is polled fast so its end is not missed. */
  readonly nearEnd: boolean
}

/** Decides when a streaming program has actually finished; never from a rounded percentage alone. */
export interface CompletionTracker {
  readonly update: CompletionUpdate
  status: (telemetry: Telemetry) => CompletionUpdate
  line: (line: Line, telemetry: Telemetry | null) => CompletionUpdate
  pauseRequested: () => void
  stopRequested: () => void
  disconnected: () => CompletionUpdate
  tick: (now: number) => CompletionUpdate
  /** A program stream exists: acknowledgements belong to played lines. */
  readonly streaming: boolean
}

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

export interface JobProtocol {
  path: (id: string) => string
  homedQuery: OutboundFrame
  /** Parses the homed report (which may carry its acknowledgement); null for other text. */
  homed: (text: string) => { homed: boolean; acknowledged: boolean } | null
  assistPlan: (
    assists: PlateAssists | null,
    telemetry: Telemetry
  ) => AssistStep[]
  /**
   * Sent just before play so the program's first tool change stops for the tool and measures
   * it, where the firmware would skip a change to the tool it believes is loaded; null when
   * nothing needs forgetting.
   */
  toolReset: (
    program: PreparedProgram,
    identity: Identity,
    telemetry: Telemetry
  ) => SettingStep | null
  bedClean: (telemetry: Telemetry) => boolean | null
  createTransfer: (
    bytes: Uint8Array,
    md5: string,
    path: string
  ) => TransferProtocol
  play: (path: string) => OutboundFrame
  /**
   * The size of the file a play was given, from the line the machine reports it with; null for
   * other text. Where a play names its file only by a checksum, the size tells whether the file
   * sent is the one playing.
   */
  playedFileSize: (text: string) => number | null
  createCompletion: (
    program: PreparedProgram,
    bedClean: boolean | null,
    now: () => number
  ) => CompletionTracker
}

export interface FirmwareAdapter {
  readonly id: string
  readonly defaultPort: number
  readonly discovery: {
    readonly port: number
    parse: (data: Uint8Array, sender: string) => NetworkDevice | null
  }
  createInterpreter: () => FirmwareInterpreter
  encode: (frame: OutboundFrame) => Uint8Array
  readonly queries: {
    readonly identity: OutboundFrame
    readonly status: OutboundFrame
    readonly diagnostics: OutboundFrame
  }
  readonly halt: OutboundFrame
  /** Reboots the controller; the connection does not outlive it. */
  readonly restart: OutboundFrame
  /** What the machine has; whether it stores anchors follows from `anchors`. */
  features: (
    identity: Identity,
    telemetry: Telemetry | null
  ) => Omit<MachineFeatures, "anchors">
  /** Wire plan for a command, using the fresh telemetry it was admitted with. */
  plan: (command: MachineCommand, telemetry: Telemetry) => CommandPlan
  readonly rules: FirmwareRules
  /** The ranges its manual controls accept; commands outside them are refused. */
  readonly limits: ControlLimits
  prepareProgram: (source: string) => PreparedProgram
  readonly job: JobProtocol
  /**
   * Reads the anchors the machine stores, one configuration value per key; absent when it
   * stores none.
   */
  readonly anchors?: {
    /** Machine-state preconditions for reading them, or null. */
    admit: (telemetry: Telemetry) => string | null
    readonly keys: readonly string[]
    query: (key: string) => OutboundFrame
    /** The value for `key`, null when unset or invalid, undefined for unrelated text. */
    parse: (text: string, key: string) => number | null | undefined
    /** A keyed reply from any anchor read or write (delayed replies are swallowed). */
    isReply: (text: string) => boolean
    /** The anchors from the values of `keys`, in order, with ids that never change. */
    build: (values: readonly number[], fetchedAt: number) => AnchorConfiguration
    /**
     * Stores anchors in the machine's configuration, one value per key; absent when they cannot
     * be changed. Reading the keys again verifies what it stores.
     */
    readonly write?: {
      /**
       * The values of `keys`, in order, that store these positions, as the configuration keeps
       * them; throws for positions of other anchors than the machine's own.
       */
      values: (anchors: readonly AnchorPosition[]) => readonly number[]
      command: (key: string, value: number) => OutboundFrame
      /** True when `text` confirms `key` holds `value`, why not when it refuses, undefined for unrelated text. */
      confirm: (
        text: string,
        key: string,
        value: number
      ) => true | string | undefined
      /** The machine's own moves use stored anchors as it loaded them when it started. */
      readonly afterRestart: boolean
    }
  }
  readonly heightMap: {
    readonly query: OutboundFrame
    parse: (raw: string, receivedAt: number, deviceId: string) => HeightMap
  }
  cameraUrl: (device: ConnectedDevice) => string | null
}
