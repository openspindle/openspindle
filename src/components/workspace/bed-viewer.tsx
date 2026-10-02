import { CircleAlert, TriangleAlert } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useEffect, useRef, useState } from "react"
import type { FrameSource } from "@/app/job/frame"
import { useHost } from "@/platform/host-context"
import { plateLabel } from "@/domain/plate/plate"
import type {
  ViewerPlate,
  ViewerProblem,
  ViewerProblemRef,
} from "@/components/workspace/viewer/viewer-input"
import { problemMarkerId } from "./bed-viewer-layout"
import type { LineRange } from "./bed-viewer-layout"
import { BedScene } from "./viewer/bed-scene"
import type { LiveTool, MachineOrigin, ViewMode } from "./viewer/bed-scene"
import type { VisualStyle } from "./viewer/solid-style"
import type { ArrangeEvents, ArrangeView } from "./viewer/setup-arranger"

export type { Stock } from "@/domain/stock/stock"
export type {
  ViewerPlate,
  ViewerProblem,
  ViewerProblemRef,
} from "@/components/workspace/viewer/viewer-input"
export type { LiveTool, MachineOrigin, ViewMode } from "./viewer/bed-scene"
export type { VisualStyle } from "./viewer/solid-style"
export type {
  ArrangeDrag,
  ArrangeEvents,
  ArrangeMenuRequest,
  ArrangePick,
  ArrangeSelection,
  ArrangeView,
  PickedPoint,
} from "./viewer/setup-arranger"
type Props = {
  plates: ViewerPlate[]
  selectedPlateId: string | null
  onSelectPlate: (id: string) => void
  selectedLineRanges?: LineRange[]
  /** Program lines each plate leaves out of the view, such as hidden operations', by plate id. */
  hiddenLineRanges?: Readonly<Record<string, readonly LineRange[]>>
  /** Fixtures each plate leaves out of the view (their ids), by plate id. */
  hiddenFixtures?: Readonly<Record<string, readonly string[]>>
  /**
   * The frames of playback the selected plate is drawn at, which the scene follows every frame on
   * its own; without them, or while they have none, it shows its whole program.
   */
  frames?: FrameSource
  /** @deprecated Ignored: without `frames` the whole program shows. */
  progress?: number
  showRapids: boolean
  showStock: boolean
  view: ViewMode
  /** How the solids are drawn; smoothly shaded by default. */
  style?: VisualStyle
  resetKey: number
  zoom: number
  onZoomChange?: (zoom: number) => void
  /** The selected setup item and move mode, when setup items can be selected and moved. */
  arrangement?: ArrangeView
  /** Given on the first render, it makes setup items selectable and movable. */
  onArrange?: ArrangeEvents
  /** Problems marked where they are on their plates' beds, which name them on hover. */
  problems?: readonly ViewerProblem[]
  /** The problem shown: drawn stronger, and panned to when it is near an edge or beyond. */
  shownProblem?: ViewerProblemRef | null
  onSelectProblem?: (problem: ViewerProblem) => void
  /** Where the connected machine keeps work zero, marked on one plate's bed. */
  machineOrigin?: MachineOrigin | null
  /** The tool the machine reports in its spindle, shown on one plate's bed. */
  liveTool?: LiveTool | null
  /** Plates carry their labels, which select them; not in a picture such as the camera's. */
  labeled?: boolean
}

export function BedViewer({
  plates,
  selectedPlateId,
  onSelectPlate,
  selectedLineRanges,
  hiddenLineRanges,
  hiddenFixtures,
  frames,
  showRapids,
  showStock,
  view,
  style = "smooth",
  resetKey,
  zoom,
  onZoomChange,
  arrangement,
  onArrange,
  problems,
  shownProblem,
  onSelectProblem,
  machineOrigin,
  liveTool,
  labeled = true,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const labels = useRef(new Map<string, HTMLButtonElement>())
  const problemMarkers = useRef(new Map<string, HTMLElement>())
  const arrangeLabel = useRef<HTMLDivElement>(null)
  const select = useRef(onSelectPlate)
  const zoomChange = useRef(onZoomChange)
  const arrange = useRef(onArrange)
  const sceneRef = useRef<BedScene | null>(null)
  const models = useHost().models
  const [error, setError] = useState("")
  useEffect(() => {
    select.current = onSelectPlate
  }, [onSelectPlate])
  useEffect(() => {
    zoomChange.current = onZoomChange
  }, [onZoomChange])
  useEffect(() => {
    arrange.current = onArrange
  }, [onArrange])

  useEffect(() => {
    if (!container.current) return
    // The scene calls through the ref, so it always reaches the latest handlers.
    const arrangeEvents: ArrangeEvents | undefined = arrange.current && {
      select: (plateId, item) => arrange.current?.select(plateId, item),
      move: (plateId, item, delta) =>
        arrange.current?.move(plateId, item, delta) ?? false,
      menu: (request) => arrange.current?.menu(request),
      pick: (pick) => arrange.current?.pick(pick),
      drag: (drag) => arrange.current?.drag(drag),
      pickPoint: (plateId, pick) => arrange.current?.pickPoint(plateId, pick),
      pickEdge: (plateId, edge) => arrange.current?.pickEdge(plateId, edge),
    }
    const scene = BedScene.create(
      container.current,
      labels.current,
      problemMarkers.current,
      arrangeLabel,
      {
        selectPlate: (id) => select.current(id),
        zoomChange: (value) => zoomChange.current?.(value),
        error: setError,
        arrange: arrangeEvents,
      },
      (id) => models.mesh(id)
    )
    sceneRef.current = scene
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  // Presentation first, so plates added in the same render start in their final state.
  useEffect(() => {
    sceneRef.current?.present({
      selectedPlateId,
      selectedLineRanges,
      hiddenLineRanges,
      hiddenFixtures,
      showRapids,
      showStock,
      problems,
      shownProblem,
      machineOrigin,
      liveTool,
    })
  }, [
    selectedPlateId,
    selectedLineRanges,
    hiddenLineRanges,
    hiddenFixtures,
    showRapids,
    showStock,
    problems,
    shownProblem,
    machineOrigin,
    liveTool,
  ])
  // Playback sets a frame every frame: the scene follows it without a render here.
  useEffect(() => {
    if (!frames) return
    const follow = () => sceneRef.current?.setFrame(frames.get())
    follow()
    const unsubscribe = frames.subscribe(follow)
    return () => {
      unsubscribe()
      sceneRef.current?.setFrame(null)
    }
  }, [frames])
  // Unchanged plates keep their objects; the scene renders only when something changed.
  useEffect(() => {
    sceneRef.current?.setPlates(plates)
  }, [plates])
  // After the plates, so a selection always finds its item drawn.
  useEffect(() => {
    if (arrangement) sceneRef.current?.arrange(arrangement)
  }, [arrangement])
  // After the plates and the problems, so the shown problem is laid out where it is marked.
  useEffect(() => {
    if (shownProblem) sceneRef.current?.reveal(shownProblem)
  }, [shownProblem])
  useEffect(() => {
    sceneRef.current?.setView(view)
  }, [view, resetKey])
  useEffect(() => {
    sceneRef.current?.setZoom(zoom)
  }, [zoom, resetKey])
  useEffect(() => {
    sceneRef.current?.setStyle(style)
  }, [style])

  return (
    <div
      className="absolute inset-0 overflow-hidden [&>canvas]:block"
      ref={container}
      aria-label="Interactive 3D plates and NC toolpaths"
    >
      <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
        {labeled &&
          plates.map((plate, index) => {
            const label = plateLabel(plate, index)
            return (
              <Button
                variant={plate.id === selectedPlateId ? "default" : "outline"}
                className="pointer-events-auto invisible absolute -translate-x-1/2 -translate-y-1/2 shadow-sm"
                key={plate.id}
                ref={(element) => {
                  if (element) labels.current.set(plate.id, element)
                  else labels.current.delete(plate.id)
                }}
                type="button"
                aria-label={`Select ${label}`}
                aria-pressed={plate.id === selectedPlateId}
                title={label}
                onClick={() => onSelectPlate(plate.id)}
              >
                <span className="truncate">{label}</span>
              </Button>
            )
          })}
        {problems?.map((problem) => {
          const id = problemMarkerId(problem)
          const isError = problem.severity === "error"
          const Icon = isError ? CircleAlert : TriangleAlert
          const shown =
            shownProblem?.plateId === problem.plateId &&
            shownProblem.key === problem.key
          // The marker stands just above its point, which the view draws under it.
          return (
            <div
              key={id}
              className="pointer-events-auto invisible absolute -translate-x-1/2 -translate-y-full pb-1"
              ref={(element) => {
                if (element) problemMarkers.current.set(id, element)
                else problemMarkers.current.delete(id)
              }}
            >
              <Tooltip>
                <TooltipTrigger
                  delay={100}
                  render={
                    <button
                      type="button"
                      className={cn(
                        "grid size-6 place-items-center rounded-full border-2 border-background shadow-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        isError
                          ? "bg-warning text-warning-foreground"
                          : "bg-amber-500 text-amber-950",
                        shown && "ring-2 ring-ring"
                      )}
                      aria-label={`${isError ? "Error" : "Warning"}: ${problem.message}`}
                      aria-pressed={shown}
                      onClick={() => onSelectProblem?.(problem)}
                    />
                  }
                >
                  <Icon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-72">
                  {problem.message}
                </TooltipContent>
              </Tooltip>
            </div>
          )
        })}
        {/* What a click picks, beside it: where it is, and what it snapped to. */}
        <div
          ref={arrangeLabel}
          className="invisible absolute translate-x-3 -translate-y-[calc(100%+0.75rem)] rounded-md bg-foreground px-2.5 py-1.5 font-numeric text-xs whitespace-pre text-background shadow-md"
        />
      </div>
      {error && (
        <div className="absolute bottom-4 left-4 rounded-md border bg-background px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}
