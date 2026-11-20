import { createEndpoint } from "@spinnvill/rpc"
import type { RpcMessage } from "@spinnvill/rpc"
import { messagePortTransport } from "@spinnvill/rpc/message-port"
import { simulateCuts } from "@/domain/tools/cut-engagement"
import type { CutEngagement } from "@/domain/tools/cut-engagement"
import { parseGCode } from "@/domain/nc/gcode"
import { cutSimulationContract } from "./contract"

// A result's arrays are made for that reply (simulate is the only method): move them.
function resultBuffers(message: RpcMessage): Transferable[] {
  if (message.kind !== "result") return []
  const { kinds, depths, widths, belowTop } = message.result as CutEngagement
  return [kinds, depths, widths, belowTop]
    .map((array) => array.buffer)
    .filter((buffer) => buffer instanceof ArrayBuffer)
}

// The client's first message hands over the port it calls on.
self.addEventListener(
  "message",
  (event: MessageEvent) => {
    const port = event.ports.at(0)
    if (!port) return
    createEndpoint({
      transport: messagePortTransport(port, { transfer: resultBuffers }),
      serve: {
        contract: cutSimulationContract,
        handlers: {
          methods: {
            simulate: ({ source, spans, stock }) => {
              const { segments, lineCount } = parseGCode(source)
              return simulateCuts({ segments, lineCount, spans, stock })
            },
          },
          events: {},
        },
      },
    })
  },
  { once: true }
)
