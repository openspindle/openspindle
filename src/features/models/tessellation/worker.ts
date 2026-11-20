import { createEndpoint } from "@spinnvill/rpc"
import type { RpcMessage } from "@spinnvill/rpc"
import { messagePortTransport } from "@spinnvill/rpc/message-port"
import occtimportjs from "occt-import-js"
import type { Occt } from "occt-import-js"
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url"
import { tessellationContract } from "./contract"
import { OcctFailure, tessellateWith } from "./core"
import type { TessellationResult } from "./core"

let occt: Promise<Occt> | null = null

/** OpenCascade is instantiated for the first request and kept for the next ones. */
function loadOcct(): Promise<Occt> {
  occt ??= occtimportjs({
    locateFile: (path) => (path.endsWith(".wasm") ? wasmUrl : path),
  }).catch((error: unknown) => {
    occt = null
    console.error(error)
    throw new Error("The STEP converter could not be loaded.")
  })
  return occt
}

// A result's arrays are made for that reply (tessellate is the only method): move them.
function meshBuffers(message: RpcMessage): Transferable[] {
  if (message.kind !== "result") return []
  const { mesh } = message.result as TessellationResult
  return [mesh.positions, mesh.normals, mesh.indices]
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
      transport: messagePortTransport(port, { transfer: meshBuffers }),
      serve: {
        contract: tessellationContract,
        handlers: {
          methods: {
            tessellate: async ({ step }, { signal }) => {
              const instance = await loadOcct()
              signal.throwIfAborted()
              try {
                return tessellateWith(instance, step)
              } catch (error) {
                if (error instanceof OcctFailure) {
                  occt = null
                  console.error(error.cause)
                }
                throw error
              }
            },
          },
          events: {},
        },
      },
    })
  },
  { once: true }
)
