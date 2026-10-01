import type { RpcMessage, Transport } from "./transport.ts"

export interface MessagePortTransportOptions {
  /**
   * What an outgoing message transfers instead of copying, such as buffers made for one
   * reply. Transferred objects are no longer usable on the sending side.
   */
  readonly transfer?: (message: RpcMessage) => Transferable[]
}

/** Transport for DOM MessagePorts (renderer ↔ main, workers). */
export function messagePortTransport(
  port: MessagePort,
  options: MessagePortTransportOptions = {}
): Transport {
  return {
    send: (message) =>
      port.postMessage(message, options.transfer?.(message) ?? []),
    listen(onMessage, onClose) {
      const handleMessage = (event: MessageEvent) => onMessage(event.data)
      const handleClose = () => onClose("The connection closed.")
      port.addEventListener("message", handleMessage)
      port.addEventListener("close", handleClose)
      port.start()
      return () => {
        port.removeEventListener("message", handleMessage)
        port.removeEventListener("close", handleClose)
      }
    },
    close: () => port.close(),
  }
}
