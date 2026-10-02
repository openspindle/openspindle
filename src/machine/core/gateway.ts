import type {
  AnchorConfiguration,
  ConsoleEntry,
  HeightMap,
  SwitchReport,
  MachineSnapshot,
  NetworkDevice,
  PrepareResult,
  WriteAnchorsResult,
  FirmwareConfiguration,
  WriteConfigurationResult,
} from "../contract/index.ts"
import type { CameraEvent } from "./camera.ts"
import type { MachineController } from "./controller.ts"
import type { TraceEntry } from "./protocol-trace.ts"
import { MachineError } from "./errors.ts"

/** The app controls the machine; the system menu can read it and stop it. */
export type Principal = { readonly kind: "app" } | { readonly kind: "system" }

/**
 * Keeps machine control in the app while allowing the system menu to stop it directly.
 */
export class MachineGateway {
  private readonly controller: MachineController
  readonly principal: Principal

  constructor(controller: MachineController, principal: Principal) {
    this.controller = controller
    this.principal = principal
  }

  snapshot(): MachineSnapshot {
    return this.controller.snapshot()
  }

  subscribe(listener: (snapshot: MachineSnapshot) => void): () => void {
    return this.controller.subscribe(listener)
  }

  /** The recent exchange with the machine, for Help › Export Protocol Trace. */
  protocolTrace(): readonly TraceEntry[] {
    return this.controller.protocolTrace()
  }

  watchCamera(listener: (event: CameraEvent) => void): () => void {
    this.requireApp()
    return this.controller.watchCamera(listener)
  }

  watchConsole(listener: (entries: ConsoleEntry[]) => void): () => void {
    this.requireApp()
    return this.controller.watchConsole(listener)
  }

  discover(): Promise<NetworkDevice[]> {
    this.requireApp()
    return this.controller.discover()
  }

  connect(request: unknown): Promise<MachineSnapshot> {
    this.requireApp()
    return this.controller.connect(request)
  }

  disconnect(request: unknown): MachineSnapshot {
    this.requireApp()
    return this.controller.disconnect(request)
  }

  reset(): Promise<MachineSnapshot> {
    this.requireApp()
    return this.controller.reset()
  }

  execute(command: unknown, signal?: AbortSignal): Promise<MachineSnapshot> {
    this.requireApp()
    return this.controller.execute(command, signal)
  }

  /** A line typed in the app's console; only the app sends one. */
  sendConsoleLine(line: unknown): Promise<MachineSnapshot> {
    this.requireApp()
    return this.controller.sendConsoleLine(line)
  }

  /** The plate's bed, for the simulator only; only the app sends one. */
  simulateBed(bed: unknown): Promise<MachineSnapshot> {
    this.requireApp()
    return this.controller.simulateBed(bed)
  }

  /** The app and the system menu may always stop the machine. */
  stop(): Promise<MachineSnapshot> {
    return this.controller.stop()
  }

  prepare(input: unknown): Promise<PrepareResult> {
    this.requireApp()
    return this.controller.prepare(input)
  }

  run(request: unknown): Promise<MachineSnapshot> {
    this.requireApp()
    return this.controller.run(request)
  }

  dismissJob(): MachineSnapshot {
    this.requireApp()
    return this.controller.dismissJob()
  }

  readAnchors(signal?: AbortSignal): Promise<AnchorConfiguration> {
    return this.controller.readAnchors(signal)
  }

  /** Only the app changes the machine's settings. */
  writeAnchors(input: unknown): Promise<WriteAnchorsResult> {
    this.requireApp()
    return this.controller.writeAnchors(input)
  }

  readHeightMap(signal?: AbortSignal): Promise<HeightMap> {
    return this.controller.readHeightMap(signal)
  }

  readSwitches(): Promise<SwitchReport> {
    return this.controller.readSwitches()
  }

  readConfiguration(signal?: AbortSignal): Promise<FirmwareConfiguration> {
    this.requireApp()
    return this.controller.readConfiguration(signal)
  }

  writeConfiguration(input: unknown): Promise<WriteConfigurationResult> {
    this.requireApp()
    return this.controller.writeConfiguration(input)
  }

  private requireApp() {
    if (this.principal.kind !== "app")
      throw new MachineError(
        "permission",
        "Only the OpenSpindle app may do this."
      )
  }
}
