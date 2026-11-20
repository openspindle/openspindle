import { RpcError, createEndpoint } from "@spinnvill/rpc"
import type { EmptyContract, Peer } from "@spinnvill/rpc"
import { messagePortTransport } from "@spinnvill/rpc/message-port"
import { MODEL_LIMITS } from "@/domain/models/model"
import { tessellationContract } from "./contract"
import type { TessellationContract } from "./contract"
import type { TessellationResult } from "./core"

export type { TessellationResult } from "./core"

const MiB = 1024 * 1024

let current: Peer<TessellationContract> | null = null
/** Settles when every conversion requested so far has finished. */
let queue: Promise<void> = Promise.resolve()
let pending = 0

/** An idle worker ends, releasing OpenCascade's memory (over 1 GB after a large file). */
const IDLE_MS = 60_000
let idle: ReturnType<typeof setTimeout> | null = null

/** The worker, and with it the 7.6 MB OpenCascade module, loads on first use. */
function tessellator(): Peer<TessellationContract> {
  if (current) return current
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "STEP tessellation",
  })
  const channel = new MessageChannel()
  const peer = createEndpoint<EmptyContract, TessellationContract>({
    transport: messagePortTransport(channel.port1),
    remote: tessellationContract,
    // Whatever ends the connection ends the worker; the next call starts a new one.
    onClose: () => {
      if (current === peer) current = null
      worker.terminate()
    },
  })
  // A worker that fails to load never answers: fail its calls instead of waiting.
  worker.addEventListener("error", () =>
    peer.close("The STEP converter could not start.")
  )
  worker.postMessage(null, [channel.port2])
  current = peer
  return peer
}

/** Resolves when `previous` does, or rejects as soon as the caller gives up. */
function turn(previous: Promise<void>, signal: AbortSignal | undefined) {
  if (!signal) return previous
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void previous.then(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    })
  })
}

const timedOut = (error: unknown) =>
  error instanceof RpcError && error.code === "TIMEOUT"

function readableError(error: unknown): Error {
  if (timedOut(error))
    return new Error("Converting this STEP file took too long.")
  // The conversion's own messages, and the reasons the connection was closed.
  if (
    error instanceof RpcError &&
    (error.code === "FAILED" || error.code === "CANCELLED")
  )
    return new Error(error.message)
  return new Error("The STEP file could not be converted.", { cause: error })
}

async function convert(step: Uint8Array, signal: AbortSignal | undefined) {
  const peer = tessellator()
  try {
    return await peer.call("tessellate", { step }, signal ? { signal } : {})
  } catch (error) {
    // OpenCascade cannot be interrupted: a cancelled or overdue conversion ends its worker.
    if (signal?.aborted || timedOut(error))
      peer.close("The STEP conversion was stopped.")
    signal?.throwIfAborted()
    throw readableError(error)
  }
}

/**
 * Tessellates a STEP file off the main thread into one mesh in millimetres, Z up. Calls
 * run one at a time; aborting a running call stops its worker, and the next call starts a
 * fresh one. The bytes are copied to the worker, so the caller keeps them.
 */
export async function tessellateStep(
  step: Uint8Array,
  options: { signal?: AbortSignal } = {}
): Promise<TessellationResult> {
  const { signal } = options
  signal?.throwIfAborted()
  if (step.byteLength > MODEL_LIMITS.sourceBytes)
    throw new Error(
      `STEP files must be ${MODEL_LIMITS.sourceBytes / MiB} MB or smaller.`
    )
  const previous = queue
  let finish = () => {}
  const finished = new Promise<void>((resolve) => (finish = resolve))
  queue = previous.then(() => finished)
  pending++
  if (idle) clearTimeout(idle)
  try {
    await turn(previous, signal)
    return await convert(step, signal)
  } finally {
    finish()
    if (!--pending)
      idle = setTimeout(() => {
        idle = null
        current?.close("The STEP converter was idle.")
      }, IDLE_MS)
  }
}
