import type { MessageEvent, MessagePortMain } from "electron"
import type { Transport } from "@spinnvill/rpc"

/** RPC transport over an Electron main-process MessagePort. */
export function portMainTransport(port: MessagePortMain): Transport {
  return {
    send: (message) => port.postMessage(message),
    listen(onMessage, onClose) {
      const handleMessage = (event: MessageEvent) => onMessage(event.data)
      const handleClose = () => onClose("The window disconnected.")
      port.on("message", handleMessage)
      port.on("close", handleClose)
      port.start()
      return () => {
        port.off("message", handleMessage)
        port.off("close", handleClose)
      }
    },
    close: () => port.close(),
  }
}
