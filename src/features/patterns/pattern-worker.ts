import type { PatternSpec } from "@/domain/operations/pattern"
import { generateLayers } from "./pattern-layers"

self.onmessage = ({
  data,
}: MessageEvent<{ id: number; spec: PatternSpec; baseUrl: string }>) => {
  const { id, spec, baseUrl } = data
  void generateLayers(spec, baseUrl).then(
    (output) => self.postMessage({ id, output }),
    (error: unknown) =>
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      })
  )
}
