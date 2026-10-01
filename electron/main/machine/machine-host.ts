import {
  MessageChannelMain,
  dialog,
  powerSaveBlocker,
  utilityProcess,
} from "electron"
import type { BrowserWindow, MessagePortMain, UtilityProcess } from "electron"
import { fileURLToPath } from "node:url"
import { createEndpoint } from "@openspindle/rpc"
import type { EmptyContract, Peer } from "@openspindle/rpc"
import {
  disconnectedSnapshot,
  isJobActive,
} from "../../../src/machine/contract/index.ts"
import type { MachineSnapshot } from "../../../src/machine/contract/index.ts"
import type { Principal } from "../../../src/machine/core/gateway.ts"
import { machineContract } from "../../../src/platform/contract/machine-rpc"
import type { MachineContract } from "../../../src/platform/contract/machine-rpc"
import type {
  ErrorRecord,
  FromMachine,
  ToMachine,
} from "../../machine/protocol.ts"
import { showErrorMessage } from "../diagnostics/diagnostics.ts"
import type { ErrorReports } from "../diagnostics/error-reports.ts"
import { log } from "../diagnostics/log.ts"
import { portMainTransport } from "../rpc/port-main-transport.ts"
import type { FileService } from "../services/file-service.ts"

/** The machine process's entry, built beside the main process's (electron.vite.config.ts). */
const MACHINE_PROCESS = fileURLToPath(new URL("./machine.js", import.meta.url))

/** A machine process that stops this often within the window is not started again. */
const RESTARTS = 3
const RESTART_WINDOW_MS = 60_000
/** How long quitting waits for the machine process to close the connection and end. */
const QUIT_MS = 1000

export type MachineHostOptions = {
  readonly userData: string
  readonly reports: ErrorReports
  /** Each snapshot; a disconnected one when the machine process stopped. */
  readonly onChange: (snapshot: MachineSnapshot) => void
  /** The machine process started again: the window needs a port to the new one. */
  readonly onRestart: () => void
}

const rebuilt = ({ name, message, stack }: ErrorRecord): Error => {
  const error = new Error(message)
  error.name = name
  if (stack) error.stack = stack
  return error
}

/**
 * The machine as the main process hosts it: a utility process of its own (electron/machine) owns
 * the connection, so its polling, watchdog and Stop never wait for the main process. It starts
 * with the app, and again when it stops unexpectedly. The main process keeps the desktop duties
 * around it: no app suspension while connected, the menu's Stop, which it sends over its own
 * port as the system principal, the quit prompt and the protocol trace's export.
 */
export class MachineHost {
  private child: UtilityProcess | null = null
  /** The main process's own port to the machine process: the system principal. */
  private system: Peer<MachineContract> | null = null
  private latest: MachineSnapshot = disconnectedSnapshot()
  private blocker: number | null = null
  private exits: number[] = []
  private quitting = false
  private readonly options: MachineHostOptions

  constructor(options: MachineHostOptions) {
    this.options = options
  }

  /** Starts the machine process, which connects to the last used device. */
  start() {
    this.fork({ reconnect: true, error: null })
  }

  /** A port for the app renderer to the machine process; null when it does not run. */
  connectApp(): MessagePortMain | null {
    return this.child ? this.connect(this.child, "app") : null
  }

  /** Quitting disconnects but never stops the machine, so a running job needs consent. */
  get jobRunning(): boolean {
    return isJobActive(this.latest.job)
  }

  /** Machine › Stop in the menu: works however busy or unresponsive the window is. */
  async stop(): Promise<void> {
    if (!this.system) throw new Error("The machine process is not running.")
    await this.system.call("machine.stop", undefined)
  }

  /**
   * Whether to quit with a job running. It asks in a sheet on the window, which leaves the
   * main process running, as other questions do; the machine process runs on regardless.
   */
  async confirmQuit(window: BrowserWindow): Promise<boolean> {
    if (!this.jobRunning) return true
    const { response } = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["Quit", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: "A job is running on the machine.",
      detail:
        "Quitting disconnects OpenSpindle, but the machine keeps running the program. Use Stop first to end it.",
    })
    return response === 0
  }

  /** Help › Export Protocol Trace: saves the recent exchange with the machine as text. */
  async exportTrace(files: FileService) {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
    try {
      if (!this.system) throw new Error("The machine process is not running.")
      await files.save({
        kind: "trace",
        suggestedName: `openspindle-protocol-${stamp}.txt`,
        contents: await this.system.call("machine.protocolTrace", undefined),
      })
    } catch (error) {
      showErrorMessage(
        "The protocol trace was not exported",
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  /** As the app quits: the machine process closes the connection and ends, or is ended. */
  async close(): Promise<void> {
    this.quitting = true
    const child = this.child
    if (!child) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, QUIT_MS)
      child.once("exit", () => {
        clearTimeout(timer)
        resolve()
      })
      this.send(child, { kind: "quit" })
    })
  }

  dispose() {
    this.quitting = true
    this.system?.close()
    this.system = null
    this.child?.kill()
    this.child = null
    this.keepAwake(false)
  }

  private fork(start: { reconnect: boolean; error: string | null }) {
    const child = utilityProcess.fork(MACHINE_PROCESS, [], {
      serviceName: "OpenSpindle Machine",
    })
    this.child = child
    child.on("message", (message: FromMachine) => this.receive(message))
    child.on("exit", (code) => this.exited(child, code))
    this.send(child, {
      kind: "start",
      userData: this.options.userData,
      ...start,
    })
    const system = createEndpoint<EmptyContract, MachineContract>({
      transport: portMainTransport(this.connect(child, "system")),
      remote: machineContract,
      log,
    })
    this.system = system
    system.subscribe("machine.changed", undefined, (snapshot) =>
      this.changed(snapshot)
    )
  }

  private connect(
    child: UtilityProcess,
    principal: Principal["kind"]
  ): MessagePortMain {
    const { port1, port2 } = new MessageChannelMain()
    this.send(child, { kind: "connect", principal }, [port1])
    return port2
  }

  private send(
    child: UtilityProcess,
    message: ToMachine,
    ports: MessagePortMain[] = []
  ) {
    child.postMessage(message, ports)
  }

  private receive(message: FromMachine) {
    if (message.kind === "log")
      log.write(message.level, "machine", message.message, message.detail)
    else
      this.options.reports.processError(
        "machine",
        rebuilt(message.error),
        message.mechanism
      )
  }

  private changed(snapshot: MachineSnapshot) {
    this.latest = snapshot
    this.keepAwake(snapshot.connection.status === "connected")
    this.options.onChange(snapshot)
  }

  /**
   * The machine process ended. Unless the app quits, that is unexpected: the connection ended
   * with it, so a new process starts and its snapshots say why, unless it keeps stopping.
   */
  private exited(child: UtilityProcess, code: number) {
    if (this.child !== child) return
    this.child = null
    this.system?.close()
    this.system = null
    if (this.quitting) return
    const now = Date.now()
    this.exits = [
      ...this.exits.filter((time) => now - time < RESTART_WINDOW_MS),
      now,
    ]
    const again = this.exits.length <= RESTARTS
    const error = again
      ? `OpenSpindle's machine process stopped (exit code ${code}), which ended the connection. A running program keeps running on the machine: connect again to follow or stop it.`
      : `OpenSpindle's machine process stopped ${this.exits.length} times within a minute (exit code ${code}) and was not started again. A running program keeps running on the machine: restart OpenSpindle to connect again.`
    this.options.reports.processError("machine", new Error(error), "onexit")
    this.changed(disconnectedSnapshot(0, "Connect a device first.", error))
    if (!again) return
    this.fork({ reconnect: false, error })
    this.options.onRestart()
  }

  private keepAwake(connected: boolean) {
    if (connected && this.blocker === null)
      this.blocker = powerSaveBlocker.start("prevent-app-suspension")
    else if (!connected && this.blocker !== null) {
      powerSaveBlocker.stop(this.blocker)
      this.blocker = null
    }
  }
}
