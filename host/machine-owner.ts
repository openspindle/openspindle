import { parentPort, workerData } from "node:worker_threads"
import { MachineController } from "../src/machine/core/controller.ts"
import { MachineGateway } from "../src/machine/core/gateway.ts"
import { nodeMachinePorts } from "../electron/machine/node-ports.ts"
import { ProgramWorker } from "../electron/machine/program-worker.ts"
import { JobHistory } from "./services/job-history.ts"

const port = parentPort
if (!port) throw new Error("Machine owner requires a worker thread.")
const settings = workerData as {
  data: string
  machineHost?: string
  machinePort?: number
  usbId?: string
  cameraHost?: string
}
const report = (message: string) =>
  port.postMessage({ kind: "warning", message })
const history = new JobHistory(settings.data, report)
history.recover()
const programs = new ProgramWorker()
const controller = new MachineController({
  ...nodeMachinePorts,
  programs,
  journal: history,
  log: { warn: report },
})
const gateway = new MachineGateway(controller, { kind: "app" })
let camera: (() => void) | null = null
controller.subscribe((snapshot) =>
  port.postMessage({ kind: "snapshot", snapshot })
)
port.postMessage({ kind: "snapshot", snapshot: gateway.snapshot() })
port.on(
  "message",
  async ({
    id,
    method,
    input,
  }: {
    id: number
    method: string
    input: unknown
  }) => {
    try {
      let result: unknown
      switch (method) {
        case "snapshot":
          result = gateway.snapshot()
          break
        case "connect":
          result = await gateway.connect(input)
          break
        case "serialDevices":
          result = await gateway.serialDevices()
          break
        case "disconnect":
          result = gateway.disconnect(input)
          break
        case "discover":
          result = await gateway.discover()
          break
        case "run":
          result = await gateway.run(input)
          break
        case "stop":
          result = await gateway.stop()
          break
        case "execute":
          result = await gateway.execute(input)
          break
        case "camera.start":
          camera ??= gateway.watchCamera((event) => {
            if (event.kind === "frame")
              port.postMessage({
                kind: "frame",
                jpeg: event.jpeg,
                at: event.receivedAt,
              })
            else
              port.postMessage({ kind: "camera-status", status: event.status })
          })
          result = { enabled: true }
          break
        case "camera.stop":
          camera?.()
          camera = null
          result = { enabled: false }
          break
        default:
          throw new Error("Unsupported machine-owner request.")
      }
      port.postMessage({ id, result })
    } catch (error) {
      port.postMessage({
        id,
        error:
          error instanceof Error ? error.message : "Machine request failed.",
      })
    }
  }
)
if (settings.usbId && settings.machineHost)
  throw new Error("Configure either USB or TCP, never both.")
if (settings.usbId || settings.machineHost)
  gateway
    .connect(
      settings.usbId
        ? {
            transport: "serial",
            portId: settings.usbId,
            ...(settings.cameraHost ? { cameraHost: settings.cameraHost } : {}),
          }
        : { host: settings.machineHost!, port: settings.machinePort ?? 2222 }
    )
    .catch((error) =>
      report(error instanceof Error ? error.message : "Connection failed.")
    )
