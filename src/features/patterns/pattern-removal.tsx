import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import type { RemovalGrid, RemovalInput } from "@/domain/tools/material-removal"
import type { GeneratedPattern } from "./pattern-core"

export function PatternRemoval({ pattern }: { pattern: GeneratedPattern }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [angle, setAngle] = useState(90)
  const [diameter, setDiameter] = useState(3)
  const [status, setStatus] = useState("")
  useEffect(() => {
    const surface = canvas.current
    const context = surface?.getContext("2d")
    if (!surface || !context) return
    context.clearRect(0, 0, surface.width, surface.height)
    if (angle < 10 || angle > 150 || diameter < 0.1 || diameter > 20) {
      setStatus("Use a 10–150° included angle and a 0.1–20 mm diameter.")
      return
    }
    if (pattern.points > 50000) {
      setStatus("Removal supports at most 50,000 pattern points.")
      return
    }
    const radius = diameter / 2
    const margin = radius + 0.5
    const cutter = {
      kind: "v-bit" as const,
      radius,
      tipRadius: 0,
      slope: 1 / Math.tan((angle * Math.PI) / 360),
    }
    const input: RemovalInput = {
      min: [pattern.min[0] - margin, pattern.min[1] - margin, -4],
      max: [pattern.max[0] + margin, pattern.max[1] + margin, 0],
      resolution: 1024,
      segments: pattern.paths.flatMap((path) =>
        path.map(([x, y, z], index) => {
          const end: [number, number, number] = [x, y, z]
          const [px, py, pz] = path[Math.max(0, index - 1)]
          return { start: [px, py, pz], end, cutter }
        })
      ),
    }
    setStatus("Calculating removal…")
    const worker = new Worker(
      new URL("../workshop/removal-worker.ts", import.meta.url),
      { type: "module" }
    )
    worker.onmessage = ({
      data,
    }: MessageEvent<{ grid: RemovalGrid | null; error: string | null }>) => {
      const { grid, error } = data
      if (!grid) {
        setStatus(error ?? "Removal could not be calculated.")
        return
      }
      const width = grid.columns + 1
      const height = grid.rows + 1
      surface.width = width
      surface.height = height
      const image = context.createImageData(width, height)
      const scale = Math.max(0.001, -pattern.min[2])
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const depth = Math.min(
            1,
            Math.max(0, -grid.heights[y * width + x] / scale)
          )
          const shade = 220 - 175 * depth
          const pixel = ((height - 1 - y) * width + x) * 4
          image.data[pixel] = shade
          image.data[pixel + 1] = shade
          image.data[pixel + 2] = shade
          image.data[pixel + 3] = 255
        }
      context.putImageData(image, 0, 0)
      setStatus(`Darker = deeper · ${grid.resolution.toFixed(3)} mm sampling`)
    }
    worker.onerror = () =>
      setStatus("The material-removal worker could not start.")
    worker.postMessage({
      id: 1,
      input,
      cursor: { move: input.segments.length, fraction: 1 },
    })
    return () => worker.terminate()
  }, [pattern, angle, diameter])

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      <div className="flex flex-wrap gap-3 text-xs">
        <label>
          V-bit angle (°)
          <Input
            type="number"
            min={10}
            max={150}
            value={angle}
            onChange={(event) => setAngle(Number(event.target.value))}
          />
        </label>
        <label>
          V-bit diameter (mm)
          <Input
            type="number"
            min={0.1}
            max={20}
            step={0.1}
            value={diameter}
            onChange={(event) => setDiameter(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="flex min-h-0 flex-1 justify-center overflow-auto">
        <canvas
          ref={canvas}
          aria-label="Simulated engraving depth on flat stock"
          role="img"
          className="max-h-full max-w-full self-center object-contain"
        />
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {status}
      </p>
    </div>
  )
}
