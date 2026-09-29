import { PLUGIN_ACCESSORY_KINDS } from "../contract/index.ts"
import type {
  AnchorConfiguration,
  CommandKind,
  ConsoleEntry,
  HeightMap,
  MachineSnapshot,
  NetworkDevice,
  PrepareResult,
  WriteAnchorsResult,
} from "../contract/index.ts"
import type { CameraEvent } from "./camera.ts"
import type { MachineController } from "./controller.ts"
import { MachineError } from "./errors.ts"

export type MachineGrant = "machine:read" | "machine:accessories"

/** Who is asking. Plugins hold install-time grants; the app and the system menu hold all. */
export type Principal =
  | { readonly kind: "app" }
  | { readonly kind: "system" }
  | {
      readonly kind: "plugin"
      readonly pluginId: string
      readonly grants: ReadonlySet<MachineGrant>
    }

/** Accessories a plugin may switch with machine:accessories; never motion or program control. */
export const PLUGIN_ACCESSORIES: ReadonlySet<CommandKind> = new Set(
  PLUGIN_ACCESSORY_KINDS
)

/**
 * Protection Proxy over the controller: each principal sees only what it was granted.
 * Main re-checks every plugin request here, whatever the renderer already enforced.
 */
export class MachineGateway {
  private readonly controller: MachineController
  readonly principal: Principal

  constructor(controller: MachineController, principal: Principal) {
    this.controller = controller
    this.principal = principal
  }

  snapshot(): MachineSnapshot {
    this.require("machine:read")
    return this.controller.snapshot()
  }

  subscribe(listener: (snapshot: MachineSnapshot) => void): () => void {
    this.require("machine:read")
    return this.controller.subscribe(listener)
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

  execute(command: unknown): Promise<MachineSnapshot> {
    if (this.principal.kind === "plugin") {
      this.require("machine:accessories")
      const type =
        command && typeof command === "object" && "type" in command
          ? command.type
          : null
      if (
        typeof type !== "string" ||
        !PLUGIN_ACCESSORIES.has(type as CommandKind)
      )
        throw new MachineError(
          "permission",
          "Plugins may only switch the light, beep and vacuum."
        )
    } else this.requireApp()
    return this.controller.execute(command)
  }

  /** The app and the system menu may always stop the machine. */
  stop(): Promise<MachineSnapshot> {
    if (this.principal.kind === "plugin")
      throw new MachineError("permission", "Plugins cannot stop the machine.")
    return this.controller.stop()
  }

  prepare(input: unknown): PrepareResult {
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
    this.require("machine:read")
    return this.controller.readAnchors(signal)
  }

  /** Only the app changes the machine's settings. */
  writeAnchors(input: unknown): Promise<WriteAnchorsResult> {
    this.requireApp()
    return this.controller.writeAnchors(input)
  }

  readHeightMap(signal?: AbortSignal): Promise<HeightMap> {
    this.require("machine:read")
    return this.controller.readHeightMap(signal)
  }

  private requireApp() {
    if (this.principal.kind !== "app")
      throw new MachineError(
        "permission",
        "Only the OpenSpindle app may do this."
      )
  }

  private require(grant: MachineGrant) {
    if (this.principal.kind === "plugin" && !this.principal.grants.has(grant))
      throw new MachineError(
        "permission",
        `This plugin was not granted ${grant}.`
      )
  }
}
