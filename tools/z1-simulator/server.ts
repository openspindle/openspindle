import { createSocket } from "node:dgram"
import { createServer } from "node:net"
import type { Socket } from "node:net"
import {
  FrameDecoder,
  encodeFrame,
} from "../../src/machine/firmware/makera/codec.ts"
import { SimulatedZ1 } from "./device.ts"
import type { SimulatorOptions } from "./device.ts"

/** A Z1 as it leaves the factory: homed, T1 in, Makera's anchors, at the machine's speed. */
export const DEFAULT_SIMULATOR_OPTIONS: SimulatorOptions = {
  model: 3,
  atc: false,
  bedClean: false,
  homed: true,
  tool: 1,
  anchors: [-192.4, -194.3, 88.5, 45],
  lineMs: 40,
  speed: 1,
  noDoneSnapshot: false,
  failAtLine: null,
  dropAcks: null,
  otherFile: false,
  transfer: { md5Challenge: false, placeholderMd5: false, corrupt: false },
}

export type SimulatorServer = {
  readonly device: SimulatedZ1
  readonly port: number
  close: () => void
}

/**
 * Serves a simulated Z1 where the app connects to one, on the loopback address only, to one
 * app at a time, and announces it for discovery (UDP 3333) as Makera's firmware does. Rejects
 * when the port is taken.
 */
export function serveSimulator({
  name,
  port,
  options,
  log,
  onConnect,
}: {
  name: string
  port: number
  options: SimulatorOptions
  log: (message: string) => void
  /** Each time the app connects. */
  onConnect?: (device: SimulatedZ1) => void
}): Promise<SimulatorServer> {
  let client: Socket | null = null
  const device = new SimulatedZ1(
    options,
    (type, payload) => client?.write(encodeFrame(type, payload)),
    log
  )
  device.onReboot = () => client?.destroy()

  const server = createServer((socket) => {
    if (client) {
      socket.destroy()
      return
    }
    client = socket
    log(`app connected from ${socket.remoteAddress ?? "?"}`)
    onConnect?.(device)
    const decoder = new FrameDecoder()
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const frame of decoder.push(new Uint8Array(chunk)))
          device.receive(frame)
      } catch (error) {
        log(
          `protocol error: ${error instanceof Error ? error.message : String(error)}`
        )
        socket.destroy()
      }
    })
    socket.on("close", () => {
      if (client === socket) client = null
      log("app disconnected")
    })
    socket.on("error", () => socket.destroy())
  })

  return new Promise((resolve, reject) => {
    let listening = false
    server.on("error", (error) => {
      if (listening) return log(`server: ${error.message}`)
      device.dispose()
      reject(error)
    })
    server.listen(port, "127.0.0.1", () => {
      listening = true
      log(`Z1 simulator on 127.0.0.1:${port}`)
      // Passive discovery: name,ip,port,busy,version to the app's listener.
      const announcer = createSocket("udp4")
      announcer.on("error", (error) => log(`announcing: ${error.message}`))
      const announce = setInterval(() => {
        const message = `${name},127.0.0.1,${port},${client ? 1 : 0},sim`
        announcer.send(message, 3333, "127.0.0.1")
      }, 1000)
      resolve({
        device,
        port,
        close: () => {
          clearInterval(announce)
          announcer.close()
          device.dispose()
          client?.destroy()
          server.close()
        },
      })
    })
  })
}
