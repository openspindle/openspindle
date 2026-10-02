import { RpcError, createEndpoint } from "@openspindle/rpc"
import type { EmptyContract, EndpointLog, Peer } from "@openspindle/rpc"
import { messagePortTransport } from "@openspindle/rpc/message-port"
import { disconnectedSnapshot } from "@/machine/contract"
import { machineContract } from "./contract/machine-rpc"
import type { MachineContract } from "./contract/machine-rpc"
import type { MachineHost, MachineLink } from "./host"

/** Why the connection ended when the page's port to the machine process closed. */
const STOPPED =
  "OpenSpindle's machine process stopped, which ended the connection. A running program keeps running on the machine."

/** The machine process over one port: the requests go to it as they are. */
function machineOver(peer: Peer<MachineContract>): MachineHost {
  return {
    snapshot: () => peer.call("machine.snapshot", undefined),
    subscribe: (listener) =>
      peer.subscribe("machine.changed", undefined, listener),
    discover: () => peer.call("machine.discover", undefined),
    connect: (request) => peer.call("machine.connect", request),
    disconnect: (request) => peer.call("machine.disconnect", request),
    execute: (command, signal) =>
      peer.call("machine.execute", command, signal ? { signal } : {}),
    simulateBed: (bed) => peer.call("machine.simulateBed", bed),
    sendConsoleLine: (line) => peer.call("machine.sendConsoleLine", { line }),
    stop: () => peer.call("machine.stop", undefined),
    reset: () => peer.call("machine.reset", undefined),
    prepare: (source) => peer.call("machine.prepare", { source }),
    run: (request) => peer.call("machine.run", request),
    dismissJob: () => peer.call("machine.dismissJob", undefined),
    readAnchors: (signal) =>
      peer.call("machine.readAnchors", undefined, signal ? { signal } : {}),
    writeAnchors: (request) => peer.call("machine.writeAnchors", request),
    readConfiguration: (signal) =>
      peer.call(
        "machine.readConfiguration",
        undefined,
        signal ? { signal } : {}
      ),
    writeConfiguration: (request) =>
      peer.call("machine.writeConfiguration", request),
    readHeightMap: (signal) =>
      peer.call("machine.readHeightMap", undefined, signal ? { signal } : {}),
    readSwitches: () => peer.call("machine.readSwitches", undefined),
    watchCamera: (listener) =>
      peer.subscribe("machine.camera", undefined, listener),
    watchConsole: (listener) =>
      peer.subscribe("machine.console", undefined, listener),
  }
}

/**
 * No machine process to reach: before the page's port to it arrives, and after it stopped until
 * the next one starts. Its snapshot is disconnected, with `error` as why, and requests fail.
 */
function unreachableMachine(error: string | null): MachineHost {
  const snapshot = disconnectedSnapshot(0, undefined, error)
  const refuse = () =>
    Promise.reject(
      new RpcError(
        "UNAVAILABLE",
        "OpenSpindle's machine process is not running.",
        { machine: "not-connected" }
      )
    )
  return {
    snapshot: () => Promise.resolve(snapshot),
    subscribe: (listener) => {
      listener(snapshot)
      return () => {}
    },
    discover: refuse,
    connect: refuse,
    disconnect: refuse,
    execute: refuse,
    simulateBed: refuse,
    sendConsoleLine: refuse,
    stop: refuse,
    reset: refuse,
    prepare: refuse,
    run: refuse,
    dismissJob: refuse,
    readAnchors: refuse,
    writeAnchors: refuse,
    readConfiguration: refuse,
    writeConfiguration: refuse,
    readHeightMap: refuse,
    readSwitches: refuse,
    watchCamera: (listener) => {
      listener({ kind: "status", status: "error" })
      return () => {}
    },
    watchConsole: () => () => {},
  }
}

/**
 * The page's link to the machine process: each port the main process hands it is another
 * MachineHost, and the link is unreachable while it has none open. `log` records what the
 * connection refuses.
 */
export function createMachineLink(
  log: EndpointLog
): MachineLink & { readonly attach: (port: MessagePort) => void } {
  let current = unreachableMachine(null)
  let peer: Peer<MachineContract> | null = null
  const listeners = new Set<() => void>()
  const change = (next: MachineHost) => {
    current = next
    for (const listener of [...listeners]) listener()
  }
  return {
    current: () => current,
    subscribe: (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    attach: (port) => {
      const previous = peer
      const next = createEndpoint<EmptyContract, MachineContract>({
        transport: messagePortTransport(port),
        remote: machineContract,
        log,
        onClose: () => {
          if (peer !== next) return
          peer = null
          change(unreachableMachine(STOPPED))
        },
      })
      peer = next
      previous?.close()
      change(machineOver(next))
    },
  }
}
