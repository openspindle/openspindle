import { useEffect, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { BedViewer } from "@/components/workspace/bed-viewer"
import type { ViewerPlate } from "@/components/workspace/bed-viewer"
import { DEFAULT_VIEWER_LAYERS } from "@/components/workspace/viewer/viewer-input"
import {
  useViewerCamera,
  ViewerToolbar,
} from "@/features/viewer/viewer-toolbar"
import { useVisualStyle } from "@/features/viewer/visual-style"
import type { RemovalGrid, RemovalInput } from "@/domain/tools/material-removal"
import type { RemovalCutter } from "@/domain/tools/removal-cutter"
import { parseGCode } from "@/domain/nc/gcode"
import type { Point3 } from "@/domain/nc/gcode"
import type { LayeredOutput } from "./pattern-layers"

const ID = "pattern-preview"
const empty = parseGCode("")
const selectPreview = () => {}
const layers = {
  ...DEFAULT_VIEWER_LAYERS,
  bed: false,
  axes: false,
  fixtures: false,
  stock: true,
  tool: false,
  toolSetter: false,
}

export function PatternPreview({
  output,
  removal,
  width,
  hidden,
}: {
  output: LayeredOutput | null
  removal: boolean
  width: number
  hidden: ReadonlySet<number>
}) {
  const camera = useViewerCamera()
  const [style] = useVisualStyle()
  const [angle, setAngle] = useState(90)
  const [diameter, setDiameter] = useState(3)
  const [tip, setTip] = useState(0)
  const [state, setState] = useState<{
    input: RemovalInput
    grid: RemovalGrid | null
    error: string | null
  }>()
  const bounds = useMemo(() => {
    if (!output) return null
    const { min, max } = output.generated
    const margin = Math.max(
      2,
      diameter / 2 + 0.5,
      ...output.layers.map((layer) => (layer.cutterDiameter ?? 0) / 2 + 0.5)
    )
    const low: Point3 = [min[0], min[1], min[2]]
    const high: Point3 = [max[0], max[1], 0]
    for (const layer of output.layers) {
      if (!layer.mask) continue
      for (const path of layer.paths)
        for (const [x, y] of path) {
          low[0] = Math.min(low[0], x)
          low[1] = Math.min(low[1], y)
          high[0] = Math.max(high[0], x)
          high[1] = Math.max(high[1], y)
        }
    }
    return {
      min: [low[0] - margin, low[1] - margin, Math.min(-1, low[2])] as Point3,
      max: [high[0] + margin, high[1] + margin, 0] as Point3,
    }
  }, [output, diameter])
  const valid =
    angle >= 10 &&
    angle <= 150 &&
    diameter >= 0.1 &&
    diameter <= 20 &&
    tip >= 0 &&
    tip < diameter
  const input = useMemo<RemovalInput | null>(() => {
    if (
      !removal ||
      !output ||
      !bounds ||
      !valid ||
      output.generated.points > 50000
    )
      return null
    const engraver: RemovalCutter = {
      kind: "v-bit",
      radius: diameter / 2,
      tipRadius: tip / 2,
      slope: 1 / Math.tan((angle * Math.PI) / 360),
    }
    return {
      ...bounds,
      resolution: 1024,
      segments: output.layers.flatMap((layer) => {
        if (layer.mask) return []
        const cutter: RemovalCutter = layer.cutterDiameter
          ? { kind: "flat", radius: layer.cutterDiameter / 2 }
          : engraver
        return layer.paths.flatMap((path) =>
          path.map((end, i) => ({
            start: path[Math.max(0, i - 1)],
            end,
            cutter,
          }))
        )
      }),
    }
  }, [angle, bounds, diameter, output, removal, tip, valid])
  useEffect(() => {
    if (!input) return
    const worker = new Worker(
      new URL("../workshop/removal-worker.ts", import.meta.url),
      { type: "module" }
    )
    worker.onmessage = ({
      data,
    }: MessageEvent<{ grid: RemovalGrid | null; error: string | null }>) =>
      setState({ input, ...data })
    worker.onerror = () =>
      setState({
        input,
        grid: null,
        error: "The material-removal worker could not start.",
      })
    const timer = window.setTimeout(
      () =>
        worker.postMessage({
          id: 1,
          input,
          cursor: { move: input.segments.length, fraction: 1 },
        }),
      100
    )
    return () => {
      window.clearTimeout(timer)
      worker.terminate()
    }
  }, [input])
  const grid = input && state?.input === input ? state.grid : null
  const strokes = useMemo(
    () =>
      (output?.layers ?? []).flatMap((layer) => {
        if (hidden.has(layer.index) || (removal && !layer.mask)) return []
        const positionCount = layer.paths.reduce(
          (sum, path) => sum + Math.max(0, path.length - 1) * 6,
          0
        )
        const positions = new Float32Array(positionCount)
        let offset = 0
        for (const path of layer.paths)
          for (let i = 1; i < path.length; i++) {
            for (const [x, y, z] of [path[i - 1], path[i]]) {
              positions.set([x, y, z + (layer.mask ? 0.005 : 0)], offset)
              offset += 3
            }
          }
        return [{ color: layer.color, positions }]
      }),
    [output, removal, hidden]
  )
  const plates = useMemo<ViewerPlate[]>(() => {
    if (!bounds) return []
    return [
      {
        id: ID,
        name: "Pattern",
        program: empty,
        machineProgram: empty,
        tools: [],
        toolpathBounds: null,
        stockAnchor: bounds.min,
        workOrigin: [0, 0, 0],
        stock: {
          id: ID,
          name: "Preview stock",
          material: "Metal",
          color: "#a7adb7",
          width: bounds.max[0] - bounds.min[0],
          depth: bounds.max[1] - bounds.min[1],
          height: -bounds.min[2],
        },
        deviceId: null,
      },
    ]
  }, [bounds])
  const preview = useMemo(
    () => (bounds ? { bounds, width, strokes } : undefined),
    [bounds, strokes, width]
  )
  const status = (() => {
    if (!removal || !output) return null
    if (!valid)
      return "Use a 10–150° angle, a 0.1–20 mm diameter, and a smaller tip diameter."
    if (!input) return "Removal supports up to 50,000 cutting points."
    if (state?.input !== input) return "Calculating removal…"
    return (
      state.error ?? (grid ? `${grid.resolution.toFixed(3)} mm sampling` : null)
    )
  })()
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      {removal && (
        <div className="flex flex-wrap gap-2 text-xs">
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
          <label>
            Flat tip (mm)
            <Input
              type="number"
              min={0}
              max={diameter}
              step={0.01}
              value={tip}
              onChange={(event) => setTip(Number(event.target.value))}
            />
          </label>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <BedViewer
          plates={plates}
          selectedPlateId={ID}
          onSelectPlate={selectPreview}
          labeled={false}
          layers={layers}
          removal={grid ? { plateId: ID, grid } : null}
          preview={preview}
          showRapids={false}
          showStock={removal && !!grid}
          view={camera.view}
          style={style}
          resetKey={camera.resetKey}
          zoom={camera.zoom}
          onZoomChange={camera.setZoom}
        />
        <ViewerToolbar camera={camera} />
      </div>
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  )
}
