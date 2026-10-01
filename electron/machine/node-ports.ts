import { createHash } from "node:crypto"
import { createSocket } from "node:dgram"
import { Socket } from "node:net"
import type {
  CameraConnector,
  Clock,
  DatagramListener,
  MachinePorts,
  TcpConnector,
} from "../../src/machine/core/ports.ts"

const clock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, milliseconds) => ({
    timer: setTimeout(callback, milliseconds),
  }),
  clearTimeout: (handle) => {
    if (handle) clearTimeout(handle.timer as ReturnType<typeof setTimeout>)
  },
}

/**
 * Why a connection did not open. macOS refuses the local network to an app the user has not
 * let use it, and the refusal reads as an unreachable host, so the message says where to allow
 * it.
 */
function notConnected(
  host: string,
  port: number,
  error: NodeJS.ErrnoException
): string {
  if (error.code === "EHOSTUNREACH" && process.platform === "darwin")
    return `Could not reach ${host}:${port}. Check that the machine is on this network and that OpenSpindle may use the local network: System Settings › Privacy & Security › Local Network.`
  return `Could not connect to ${host}:${port} (${error.code ?? error.message}).`
}

const tcp: TcpConnector = {
  connect(host, port, events) {
    const socket = new Socket()
    let connected = false
    let closed = false
    const close = (error: string | null) => {
      if (closed) return
      closed = true
      events.closed(error)
    }
    socket.on("connect", () => {
      connected = true
      socket.setNoDelay(true)
      socket.setKeepAlive(true, 1000)
      events.open()
    })
    socket.on("data", (chunk: Buffer) =>
      events.data(
        new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      )
    )
    socket.on("error", (error: NodeJS.ErrnoException) =>
      close(
        connected
          ? `The device connection failed (${error.code ?? error.message}).`
          : notConnected(host, port, error)
      )
    )
    socket.on("end", () => close("The device closed the connection."))
    socket.on("close", () => close("The device connection closed."))
    socket.connect({ host, port, family: 4 })
    return {
      write: (bytes) => {
        if (!closed) socket.write(bytes)
      },
      destroy: () => {
        closed = true
        socket.destroy()
      },
    }
  },
}

const udp: DatagramListener = {
  listen(port, events) {
    const socket = createSocket({ type: "udp4", reuseAddr: true })
    let stopped = false
    const stop = () => {
      if (stopped) return
      stopped = true
      try {
        socket.close()
      } catch {
        // A failed bind already closed the socket.
      }
    }
    socket.on("error", (error) => {
      events.error(error.message)
      stop()
    })
    socket.on("message", (message, sender) =>
      events.message(new Uint8Array(message), sender.address)
    )
    socket.bind(port, "0.0.0.0", () => {
      if (!stopped) events.ready()
    })
    return stop
  },
}

const camera: CameraConnector = {
  open(url, events) {
    const socket = new WebSocket(url)
    socket.binaryType = "arraybuffer"
    socket.onopen = () => events.open()
    socket.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer)
        events.binary(new Uint8Array(event.data))
    }
    socket.onerror = () => events.closed()
    socket.onclose = () => events.closed()
    return {
      send: (text) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(text)
      },
      close: () => {
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        socket.close()
      },
    }
  },
}

export const nodeMachinePorts: MachinePorts = {
  clock,
  tcp,
  udp,
  camera,
  md5: (bytes) => createHash("md5").update(bytes).digest("hex"),
}
