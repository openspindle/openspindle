import { MaterialRemoval } from "@/domain/tools/material-removal"
import type { RemovalCursor } from "@/domain/tools/material-removal"

type Request = { id: number; cursor: RemovalCursor; input?: unknown }
let model: MaterialRemoval | null = null
self.addEventListener("message", (event: MessageEvent<Request>) => {
  const { id, input, cursor } = event.data
  try {
    if (input) model = new MaterialRemoval(input)
    if (!model) throw new Error("The sampled removal model is unavailable.")
    const grid = model.at(cursor)
    self.postMessage(
      { id, grid, error: null },
      { transfer: [grid.heights.buffer] }
    )
  } catch (error) {
    self.postMessage({
      id,
      grid: null,
      error:
        error instanceof Error
          ? error.message
          : "Material removal could not be calculated.",
    })
  }
})
