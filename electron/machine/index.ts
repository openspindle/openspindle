import type { MessagePortMain } from "electron"
import { createEndpoint } from "@openspindle/rpc"
import type { MachineSnapshot } from "../../src/machine/contract/index.ts"
import { MachineController } from "../../src/machine/core/controller.ts"
import { MachineGateway } from "../../src/machine/core/gateway.ts"
import { machineContract } from "../../src/platform/contract/machine-rpc"
import { portMainTransport } from "../main/rpc/port-main-transport.ts"
import { createMachineHandlers } from "./handlers.ts"
import { LastDevice } from "./last-device.ts"
import { log } from "./log.ts"
import { nodeMachinePorts } from "./node-ports.ts"
import { ProgramWorker } from "./program-worker.ts"
import type { ErrorRecord, FromMachine, ToMachine } from "./protocol.ts"

/**
 * The machine process, an Electron utility process: the only owner of the machine connection.
 * Its loop does the machine's work alone (status polling, the watchdog, Stop), so nothing the
 * window or the main process does holds it up, and programs are prepared on a thread of their
 * own. The main process starts it and hands it a port per principal: the app renderer's, and
 * its own for the system menu.
 */

type Started = {
  readonly controller: MachineController
  readonly programs: ProgramWorker
  readonly gateways: { readonly [TKind in "app" | "system"]: MachineGateway }
}

let started: Started | null = null

const post = (message: FromMachine) => process.parentPort.postMessage(message)

const errorRecord = (error: unknown): ErrorRecord =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: "Error", message: String(error), stack: undefined }

// As in the main process before: reported, and the connection, with Stop, goes on.
process.on("uncaughtException", (error) =>
  post({
    kind: "error",
    mechanism: "onuncaughtexception",
    error: errorRecord(error),
  })
)
process.on("unhandledRejection", (reason) =>
  post({
    kind: "error",
    mechanism: "onunhandledrejection",
    error: errorRecord(reason),
  })
)

process.parentPort.on("message", ({ data, ports }) => {
  const message = data as ToMachine
  switch (message.kind) {
    case "start":
      started ??= start(message)
      return
    case "connect":
      if (started && ports[0])
        serve(ports[0], started.gateways[message.principal])
      return
    case "quit":
      quit()
  }
})

function start({
  userData,
  reconnect,
  error,
}: Extract<ToMachine, { kind: "start" }>): Started {
  const programs = new ProgramWorker()
  const controller = new MachineController(
    { ...nodeMachinePorts, programs, log },
    { error }
  )
  const gateways = {
    app: new MachineGateway(controller, { kind: "app" }),
    system: new MachineGateway(controller, { kind: "system" }),
  }
  const lastDevice = new LastDevice(userData)
  const logChanges = changeLog()
  controller.subscribe((snapshot) => {
    logChanges(snapshot)
    const { status, device } = snapshot.connection
    if (status === "connected" && device) lastDevice.remember(device)
  })
  if (reconnect) void connectLastDevice(gateways.app, lastDevice)
  return { controller, programs, gateways }
}

/**
 * At launch: one attempt to connect to the device the app last connected to. A device that is
 * off or unreachable fails within the handshake timeout, and the snapshot says why.
 */
async function connectLastDevice(app: MachineGateway, lastDevice: LastDevice) {
  const target = await lastDevice.read()
  if (!target) return
  // The app's own connection, restored for it: the app principal connects.
  await app.connect(target).catch(() => undefined)
}

function serve(port: MessagePortMain, gateway: MachineGateway) {
  createEndpoint({
    transport: portMainTransport(port),
    serve: {
      contract: machineContract,
      handlers: createMachineHandlers(gateway),
    },
    log,
  })
}

/** Quitting disconnects but never stops the machine: the main process asked about a running job. */
function quit() {
  started?.controller.dispose()
  started?.programs.dispose()
  process.exit(0)
}

/** Records the connection's and the job's changes in the app's log. */
function changeLog(): (snapshot: MachineSnapshot) => void {
  // A start has no connection.
  const logged = { connection: "Machine disconnected", job: "" }
  return ({ connection, job }) => {
    const { status, device, error } = connection
    const place = device
      ? ` ${device.name} (${device.model}) at ${device.host}:${device.port}`
      : ""
    const connectionLine = `Machine ${status}${place}${error ? `: ${error}` : ""}`
    if (connectionLine !== logged.connection) {
      if (error) log.warn(connectionLine)
      else log.info(connectionLine)
      logged.connection = connectionLine
    }
    const jobLine = job
      ? `Job ${job.id} "${job.name}" ${job.phase}${job.error ? `: ${job.error}` : ""}`
      : ""
    if (jobLine && jobLine !== logged.job) {
      if (job?.error) log.warn(jobLine)
      else log.info(jobLine)
    }
    logged.job = jobLine
  }
}
