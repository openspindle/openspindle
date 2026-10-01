import { createEndpoint } from "@openspindle/rpc"
import type { EmptyContract, EndpointLog } from "@openspindle/rpc"
import { messagePortTransport } from "@openspindle/rpc/message-port"
import { RPC_PORT_MESSAGE, RPC_SERVICES } from "./contract/channels"
import type { RpcService } from "./contract/channels"
import { hostContract } from "./contract/host-contract"
import type { HostContract } from "./contract/host-contract"
import type { Host } from "./host"
import { createMachineLink } from "./machine-link"

/** Exposed by the preload script; it only asks the main process for the page's RPC ports. */
export type OpenSpindleBridge = { readonly connect: () => void }

declare global {
  interface Window {
    openSpindleBridge?: OpenSpindleBridge
  }
}

/**
 * The preload forwards each port it is given to this window, with the service at its other end;
 * ignore frames and other senders. The machine process's ports come again after it restarted.
 */
function receivePorts(
  onPort: (service: RpcService, port: MessagePort) => void
) {
  window.addEventListener("message", (event: MessageEvent) => {
    const data: unknown = event.data
    if (
      event.source !== window ||
      !data ||
      typeof data !== "object" ||
      (data as { type?: unknown }).type !== RPC_PORT_MESSAGE ||
      !event.ports[0]
    )
      return
    const service = (data as { service?: unknown }).service
    const known = RPC_SERVICES.find((candidate) => candidate === service)
    if (known) onPort(known, event.ports[0])
  })
}

/** `log` records what the connection refuses: events and results that fail the contract. */
export async function connectElectronHost(
  bridge: OpenSpindleBridge,
  log: EndpointLog
): Promise<Host> {
  const machine = createMachineLink(log)
  const port = await new Promise<MessagePort>((resolve) => {
    receivePorts((service, received) => {
      if (service === "machine") machine.attach(received)
      else resolve(received)
    })
    bridge.connect()
  })
  const peer = createEndpoint<EmptyContract, HostContract>({
    transport: messagePortTransport(port),
    remote: hostContract,
    log,
  })
  return {
    machine,
    files: {
      open: (kind) => peer.call("files.open", { kind }),
      save: (request) => peer.call("files.save", request),
      subscribeOpened: (listener) =>
        peer.subscribe("files.opened", undefined, listener),
    },
    fusion: {
      snapshot: () => peer.call("fusion.snapshot", undefined),
      subscribe: (listener) =>
        peer.subscribe("fusion.changed", undefined, listener),
      pair: (requestId, code, signal) =>
        peer.call("fusion.pair", { requestId, code }, signal ? { signal } : {}),
      dismissPairing: (requestId) =>
        peer.call("fusion.dismissPairing", { requestId }),
      list: (signal) =>
        peer.call("fusion.list", undefined, signal ? { signal } : {}),
      read: (id, signal) =>
        peer.call("fusion.read", { id }, signal ? { signal } : {}),
      disconnect: () => peer.call("fusion.disconnect", undefined),
    },
    storage: {
      read: (key) => peer.call("storage.read", { key }),
      write: (key, value) => peer.call("storage.write", { key, value }),
      backup: (key) => peer.call("storage.backup", { key }),
      remove: (key) => peer.call("storage.remove", { key }),
    },
    models: {
      list: () => peer.call("models.list", undefined),
      mesh: (id) => peer.call("models.mesh", { id }),
      source: (id) => peer.call("models.source", { id }),
      add: (entry) => peer.call("models.add", entry),
      rename: (id, name) => peer.call("models.rename", { id, name }),
      remove: (id) => peer.call("models.remove", { id }),
    },
    menu: {
      subscribe: (listener) =>
        peer.subscribe("menu.command", undefined, listener),
    },
    window: {
      // Resolves so a caller can tell whether the report landed and retry if it did not.
      setEdited: (edited, name) =>
        peer.call("window.setEdited", { edited, name }),
      // Fire and forget: the window may be closing, and a later report replaces this one.
      close: () => {
        peer.call("window.close", undefined).catch(() => undefined)
      },
      keepWorkspace: (workspace) => {
        peer.call("window.keepWorkspace", { workspace }).catch(() => undefined)
      },
      keptWorkspace: () => peer.call("window.keptWorkspace", undefined),
    },
    pcb: {
      status: () => peer.call("pcb.status", undefined),
      chooseExecutable: () => peer.call("pcb.chooseExecutable", undefined),
      setExecutable: (executable) =>
        peer.call("pcb.setExecutable", { executable }),
      generate: (request, signal) =>
        peer.call("pcb.generate", request, signal ? { signal } : {}),
    },
    diagnostics: {
      status: () => peer.call("diagnostics.status", undefined),
      updateSettings: (patch) => peer.call("diagnostics.updateSettings", patch),
      log: (records) => {
        peer.call("diagnostics.log", { records }).catch(() => undefined)
      },
      readLog: () => peer.call("diagnostics.readLog", undefined),
      exportLog: () => peer.call("diagnostics.exportLog", undefined),
      sendError: (eventId) => peer.call("diagnostics.sendError", { eventId }),
      watchMainErrors: (listener) =>
        peer.subscribe("diagnostics.mainError", undefined, listener),
    },
  }
}
