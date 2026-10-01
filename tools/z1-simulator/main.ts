/**
 * Development-only Makera Z1 simulator: `npm run sim:z1 -- [options]`.
 * It listens where the app connects (TCP 2222), announces itself for discovery
 * (UDP 3333) and serves the camera WebSocket. Never point it at real hardware.
 */
import { createSocket } from "node:dgram"
import { createServer } from "node:net"
import type { Socket } from "node:net"
import { parseArgs } from "node:util"
import {
  FrameDecoder,
  encodeFrame,
} from "../../src/machine/firmware/makera/codec.ts"
import { startCamera } from "./camera.ts"
import { SimulatedZ1 } from "./device.ts"

const { values } = parseArgs({
  options: {
    name: { type: "string", default: "Z1 Simulator" },
    port: { type: "string", default: "2222" },
    "camera-port": { type: "string", default: "82" },
    pro: { type: "boolean", default: false },
    atc: { type: "boolean", default: false },
    "bed-clean": { type: "boolean", default: false },
    unhomed: { type: "boolean", default: false },
    tool: { type: "string", default: "1" },
    anchors: { type: "string", default: "-192.4,-194.3,88.5,45" },
    "line-ms": { type: "string", default: "40" },
    speed: { type: "string", default: "1" },
    "no-done-snapshot": { type: "boolean", default: false },
    "fail-at-line": { type: "string" },
    "drop-acks": { type: "string" },
    "other-file": { type: "boolean", default: false },
    "md5-challenge": { type: "boolean", default: false },
    "placeholder-md5": { type: "boolean", default: false },
    "corrupt-upload": { type: "boolean", default: false },
    "stall-after": { type: "string" },
    help: { type: "boolean", default: false },
  },
})

if (values.help) {
  console.log(`Z1 simulator options:
  --name <text>            announced device name
  --port <n>               TCP port (default 2222)
  --camera-port <n>        camera WebSocket port (default 82)
  --pro                    report a Z1 Pro
  --atc                    automatic tool changer (M490.2 loosens the tool)
  --bed-clean              bed cleaning after each job
  --unhomed                start with unhomed axes (play reports it and halts)
  --tool <n>               active tool at start (default 1; 0 is the probe, --tool=-1 none)
  --anchors <x,y,dx,dy>    anchor 1 and anchor 2's offset from it (default -192.4,-194.3,88.5,45)
  --line-ms <n>            milliseconds per played line (default 40)
  --speed <n>              move this many times faster than the machine (default 1)
  --no-done-snapshot       P disappears without the completion snapshot
  --fail-at-line <n>       halt with a probe failure at this program line
  --drop-acks <regexp>     never acknowledge matching commands
  --other-file             every play gets another file, one line longer (a name CRC clash)
  --md5-challenge          ask for the upload MD5 twice
  --placeholder-md5        advertise a placeholder MD5 on readback
  --corrupt-upload         corrupt the stored file (readback must fail)
  --stall-after <ms>       stop answering status this long after a connection
Keyboard: s = stall/unstall status, h = halt, q = quit`)
  process.exit(0)
}

const anchors = values.anchors.split(",").map(Number)
if (anchors.length !== 4 || anchors.some((value) => !Number.isFinite(value))) {
  console.error(
    "--anchors takes anchor 1's X and Y and anchor 2's offset: x,y,dx,dy"
  )
  process.exit(1)
}

const log = (message: string) =>
  console.log(`${new Date().toISOString().slice(11, 23)}  ${message}`)
const port = Number(values.port)
let client: Socket | null = null

const device = new SimulatedZ1(
  {
    model: values.pro ? 4 : 3,
    atc: values.atc,
    bedClean: values["bed-clean"],
    homed: !values.unhomed,
    tool: Number(values.tool),
    anchors: [anchors[0], anchors[1], anchors[2], anchors[3]],
    lineMs: Number(values["line-ms"]),
    speed: Math.max(Number(values.speed) || 1, 0.01),
    noDoneSnapshot: values["no-done-snapshot"],
    failAtLine: values["fail-at-line"] ? Number(values["fail-at-line"]) : null,
    dropAcks: values["drop-acks"] ? new RegExp(values["drop-acks"]) : null,
    otherFile: values["other-file"],
    transfer: {
      md5Challenge: values["md5-challenge"],
      placeholderMd5: values["placeholder-md5"],
      corrupt: values["corrupt-upload"],
    },
  },
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
  if (values["stall-after"])
    setTimeout(() => {
      device.answeringStatus = false
      log("status stalled")
    }, Number(values["stall-after"]))
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
server.listen(port, "127.0.0.1", () => log(`Z1 simulator on 127.0.0.1:${port}`))

// Passive discovery: name,ip,port,busy,version to the app's listener.
const announcer = createSocket("udp4")
const announce = setInterval(() => {
  const message = `${values.name},127.0.0.1,${port},${client ? 1 : 0},sim`
  announcer.send(message, 3333, "127.0.0.1")
}, 1000)

const camera = startCamera(Number(values["camera-port"]), log)

const shutdown = () => {
  clearInterval(announce)
  device.dispose()
  announcer.close()
  camera.close()
  server.close()
  client?.destroy()
  process.exit(0)
}
process.on("SIGINT", shutdown)

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.on("data", (key: Buffer) => {
    switch (key.toString()) {
      case "s":
        device.answeringStatus = !device.answeringStatus
        log(device.answeringStatus ? "status answering" : "status stalled")
        return
      case "h":
        device.halt(3, "ALARM: Hard limit")
        return
      case "q":
      case "\u0003":
        shutdown()
    }
  })
}
