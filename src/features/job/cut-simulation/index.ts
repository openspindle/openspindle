import { RpcError, createEndpoint } from "@spinnvill/rpc"
import type { EmptyContract, Peer } from "@spinnvill/rpc"
import { messagePortTransport } from "@spinnvill/rpc/message-port"
import type {
  CutEngagement,
  CutStock,
  CutToolSpan,
} from "@/domain/tools/cut-engagement"
import { cutSimulationContract } from "./contract"
import type { CutSimulationContract } from "./contract"

let current: Peer<CutSimulationContract> | null = null

/** An idle worker ends, releasing what its last sweep held on to. */
const IDLE_MS = 60_000
let idle: ReturnType<typeof setTimeout> | null = null
let pending = 0

/** The worker loads on first use. */
function simulator(): Peer<CutSimulationContract> {
  if (current) return current
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
    name: "Cut simulation",
  })
  const channel = new MessageChannel()
  const peer = createEndpoint<EmptyContract, CutSimulationContract>({
    transport: messagePortTransport(channel.port1),
    remote: cutSimulationContract,
    // Whatever ends the connection ends the worker; the next call starts a new one.
    onClose: () => {
      if (current === peer) current = null
      worker.terminate()
    },
  })
  // A worker that fails to load never answers: fail its calls instead of waiting.
  worker.addEventListener("error", () =>
    peer.close("The cut simulation could not start.")
  )
  worker.postMessage(null, [channel.port2])
  current = peer
  return peer
}

/**
 * Predicts a program's depth and width of cut off the main thread. A sweep cannot be
 * interrupted, so aborting a call stops its worker at once, and the next call starts a fresh
 * one; so does a call that takes too long.
 */
export async function simulateProgramCuts(
  params: {
    readonly source: string
    readonly spans: readonly CutToolSpan[]
    readonly stock: CutStock | null
  },
  signal: AbortSignal
): Promise<CutEngagement> {
  signal.throwIfAborted()
  if (idle) clearTimeout(idle)
  idle = null
  pending++
  const peer = simulator()
  const stop = () => peer.close("The cut simulation was stopped.")
  signal.addEventListener("abort", stop, { once: true })
  try {
    return await peer.call("simulate", {
      source: params.source,
      spans: params.spans.map((span) => ({
        segmentStart: span.segmentStart,
        segmentEnd: span.segmentEnd,
        flutes:
          span.flutes?.map(([radius, height]): [number, number] => [
            radius,
            height,
          ]) ?? null,
      })),
      stock: params.stock,
    })
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof RpcError && error.code === "TIMEOUT") stop()
    throw new Error("The depth of cut could not be calculated.", {
      cause: error,
    })
  } finally {
    signal.removeEventListener("abort", stop)
    if (!--pending)
      idle = setTimeout(() => {
        idle = null
        current?.close("The cut simulation was idle.")
      }, IDLE_MS)
  }
}
