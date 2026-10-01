import { contextBridge, ipcRenderer } from "electron"
import "@sentry/electron/preload"
import {
  RPC_CONNECT_CHANNEL,
  RPC_PORT_CHANNEL,
  RPC_PORT_MESSAGE,
  RPC_SERVICES,
} from "../../src/platform/contract/channels"

// The preload holds no feature code: it hands the page its RPC ports, to the main process and
// to the machine process, and, by the import above, Sentry's bridge, which carries the page's
// error reports to Sentry in the main process.
ipcRenderer.on(RPC_PORT_CHANNEL, (event, service: unknown) => {
  if (
    event.ports.length === 1 &&
    RPC_SERVICES.some((known) => known === service)
  )
    window.postMessage(
      { type: RPC_PORT_MESSAGE, service },
      window.location.origin,
      event.ports
    )
})

contextBridge.exposeInMainWorld("openSpindleBridge", {
  connect: () => ipcRenderer.send(RPC_CONNECT_CHANNEL),
})
