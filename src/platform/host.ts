import type {
  AnchorConfiguration,
  FirmwareConfiguration,
  WriteConfigurationRequest,
  WriteConfigurationResult,
  ConnectRequest,
  ConsoleEntry,
  DisconnectRequest,
  HeightMap,
  SwitchReport,
  MachineCommand,
  MachineSnapshot,
  NetworkDevice,
  PrepareResult,
  RunRequest,
  SimulatedBed,
  WriteAnchorsRequest,
  WriteAnchorsResult,
} from "@/machine/contract"
import type {
  PcbGeneration,
  PcbGenerationRequest,
  PcbStatus,
} from "./contract/pcb"
import type { ModelStore } from "@/persistence/models/model-library"
import type {
  FileKind,
  OpenFileResult,
  OpenedFiles,
  SaveFileRequest,
  SaveFileResult,
} from "./contract/files"
import type { CameraEvent } from "./contract/machine-rpc"
import type { SimulatorSettings, SimulatorStatus } from "./contract/simulator"
import type { BackupResult, StorageKey } from "./contract/storage"
import type { MenuCommand } from "./contract/menu"
import type {
  FusionConnectionSnapshot,
  FusionProgram,
  FusionProgramSummary,
} from "./contract/fusion"
import type {
  DiagnosticsSettings,
  DiagnosticsStatus,
  LogRecord,
  MainError,
} from "./contract/diagnostics"

/** Machine access through the machine process's controller. */
export interface MachineHost {
  snapshot: () => Promise<MachineSnapshot>
  subscribe: (listener: (snapshot: MachineSnapshot) => void) => () => void
  discover: () => Promise<NetworkDevice[]>
  connect: (request: ConnectRequest) => Promise<MachineSnapshot>
  disconnect: (request: DisconnectRequest) => Promise<MachineSnapshot>
  /** Cancellation only prevents automatic idle-off before it is sent; sent commands still verify. */
  execute: (
    command: MachineCommand,
    signal?: AbortSignal
  ) => Promise<MachineSnapshot>
  /** Tells the simulator what the plate positions on its bed; only a simulator takes it. */
  simulateBed: (bed: SimulatedBed) => Promise<MachineSnapshot>
  /** Sends a line typed in the console; the console shows what the machine replies. */
  sendConsoleLine: (line: string) => Promise<MachineSnapshot>
  stop: () => Promise<MachineSnapshot>
  /** Reboots the machine's controller, then connects to it again. */
  reset: () => Promise<MachineSnapshot>
  prepare: (source: string) => Promise<PrepareResult>
  run: (request: RunRequest) => Promise<MachineSnapshot>
  dismissJob: () => Promise<MachineSnapshot>
  readAnchors: (signal?: AbortSignal) => Promise<AnchorConfiguration>
  /** Stores the anchors in the machine's configuration; what it reads back afterwards. */
  writeAnchors: (request: WriteAnchorsRequest) => Promise<WriteAnchorsResult>
  readConfiguration: (signal?: AbortSignal) => Promise<FirmwareConfiguration>
  writeConfiguration: (
    request: WriteConfigurationRequest
  ) => Promise<WriteConfigurationResult>
  readHeightMap: (signal?: AbortSignal) => Promise<HeightMap>
  /** The machine's switches as it reads them now. */
  readSwitches: () => Promise<SwitchReport>
  watchCamera: (listener: (event: CameraEvent) => void) => () => void
  /** The machine console: its backlog at once, then new entries in batches. */
  watchConsole: (listener: (entries: ConsoleEntry[]) => void) => () => void
}

/**
 * The machine process as the page reaches it, over a port of its own. A machine process that
 * stopped and started again is another MachineHost: its snapshots' revisions and its console
 * count from the start again.
 */
export interface MachineLink {
  current: () => MachineHost
  /** Called when `current` is another MachineHost. */
  subscribe: (onChange: () => void) => () => void
}

/** Durable documents: files in the app's data folder. */
export interface StoragePort {
  read: (key: StorageKey) => Promise<string | null>
  write: (key: StorageKey, value: string) => Promise<void>
  /** Keeps a copy of the stored document; null when nothing was stored. */
  backup: (key: StorageKey) => Promise<BackupResult>
  remove: (key: StorageKey) => Promise<void>
}

export interface FileHost {
  open: (kind: FileKind) => Promise<OpenFileResult>
  save: (request: SaveFileRequest) => Promise<SaveFileResult>
  /** Files the system asks the app to open, such as with Finder's Open With. */
  subscribeOpened: (listener: (files: OpenedFiles) => void) => () => void
}

/** Discover live NC programs in Fusion; reading posts the selected program for import. */
export interface FusionHost {
  snapshot: () => Promise<FusionConnectionSnapshot>
  subscribe: (
    listener: (snapshot: FusionConnectionSnapshot) => void
  ) => () => void
  pair: (requestId: string, code: string, signal?: AbortSignal) => Promise<void>
  dismissPairing: (requestId: string) => Promise<void>
  list: (signal?: AbortSignal) => Promise<FusionProgramSummary[]>
  read: (id: string, signal?: AbortSignal) => Promise<FusionProgram>
  disconnect: () => Promise<void>
}

export interface MenuHost {
  subscribe: (listener: (command: MenuCommand) => void) => () => void
}

/**
 * The app window; the workspace is kept only across reloads of its page, so leaving it with
 * unsaved changes asks first.
 */
export interface WindowHost {
  /**
   * Whether the project has unsaved changes, and its name. Resolves once the window knows, so a
   * caller can retry a report it rejects.
   */
  setEdited: (edited: boolean, name: string) => Promise<void>
  /** Closes the window without asking again: its changes were saved. */
  close: () => void
  /**
   * Fire and forget, as the page goes away: the workspace (JSON) for the page a reload brings,
   * or null for none. Sent at once, so it arrives even while the page unloads.
   */
  keepWorkspace: (workspace: string | null) => void
  /** The workspace the window's previous page kept, if any. */
  keptWorkspace: () => Promise<string | null>
}

/** The app's log and error reports, kept by the main process. */
export interface DiagnosticsHost {
  status: () => Promise<DiagnosticsStatus>
  updateSettings: (
    patch: Partial<DiagnosticsSettings>
  ) => Promise<DiagnosticsSettings>
  /** Fire and forget: logging never holds anything up. */
  log: (records: LogRecord[]) => void
  /** The end of the log, to attach to a report. */
  readLog: () => Promise<string>
  /** Saves the log where the user chooses. */
  exportLog: () => Promise<SaveFileResult>
  /** Sends an error the user reports (it went already when reports are automatic). */
  sendError: (eventId: string) => Promise<void>
  /** Errors of the main process, as they happen. */
  watchMainErrors: (listener: (error: MainError) => void) => () => void
}

/** PCB conversion and the installed pcb2gcode program it uses. */
export interface PcbHost {
  status: () => Promise<PcbStatus>
  chooseExecutable: () => Promise<PcbStatus>
  setExecutable: (executable: string | null) => Promise<PcbStatus>
  generate: (
    request: PcbGenerationRequest,
    signal?: AbortSignal
  ) => Promise<PcbGeneration>
}

/** The simulated Z1 the app runs: whether it does, and how fast it moves. */
export interface SimulatorHost {
  status: () => Promise<SimulatorStatus>
  /** Starts or stops it, or changes its speed at once; the change is kept. */
  update: (patch: Partial<SimulatorSettings>) => Promise<SimulatorStatus>
}

/**
 * The main process and the machine process, as the renderer reaches them: every service is a
 * typed RPC call.
 */
export interface Host {
  readonly machine: MachineLink
  readonly files: FileHost
  readonly fusion: FusionHost
  readonly storage: StoragePort
  readonly models: ModelStore
  readonly menu: MenuHost
  readonly window: WindowHost
  readonly pcb: PcbHost
  readonly diagnostics: DiagnosticsHost
  readonly simulator: SimulatorHost
}
