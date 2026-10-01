import { parentPort } from "node:worker_threads"
import { prepareResult } from "../../src/machine/firmware/adapter.ts"
import { firmwareAdapter } from "../../src/machine/firmware/registry.ts"
import type { ProgramReply, ProgramRequest } from "./program-worker.ts"

/** The program worker's thread: prepares one program after another, as they are asked for. */
const port = parentPort
if (!port) throw new Error("The program worker runs only as a worker thread.")
port.on("message", ({ id, firmware, source }: ProgramRequest) => {
  let reply: ProgramReply
  try {
    reply = { id, result: prepareResult(firmwareAdapter(firmware), source) }
  } catch (error) {
    reply = {
      id,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  port.postMessage(reply)
})
