import { CircleAlert, TriangleAlert } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useEffect, useRef, useState } from "react"
import { useHost } from "@/platform/host-context"
import { plateLabel } from "@/domain/plate/plate"
import type {
  PlayheadSource,
  ViewerPlate,
  ViewerProblem,
  ViewerProblemRef,
} from "@/components/workspace/viewer/viewer-input"
import { problemMarkerId } from "./bed-viewer-layout"
import type { LineRange } from "./bed-viewer-layout"
import { BedScene } from "./viewer/bed-scene"
import type { ViewMode } from "./viewer/bed-scene"
import type { ArrangeEvents, ArrangeView } from "./viewer/setup-arranger"

export type { Stock } from "@/domain/stock/stock"
export type {
  PlayheadSource,
  ViewerPlate,
  ViewerProblem,
  ViewerProblemRef,
} from "@/components/workspace/viewer/viewer-input"
export type { ViewMode } from "./viewer/bed-scene"
export type {
  ArrangeDrag,
  ArrangeEvents,
  ArrangeMenuRequest,
  ArrangePick,
  ArrangeSelection,
  ArrangeView,
} from "./viewer/setup-arranger"
type Props = {
  plates: ViewerPlate[]
  selectedPlateId: string | null
  onSelectPlate: (id: string) => void
  selectedLineRanges?: LineRange[]
  previewLine?: number | null
  previewProbePoint?: number | null
  /**
   * Where simulated playback is along the selected plate's moves, which the scene follows every
   * frame on its own; without one, it shows up to the line.
   */
  playhead?: PlayheadSource
  progress: number
  showRapids: boolean
  showStock: boolean
  view: ViewMode
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
}

export function BedViewer({
  plates,
  selectedPlateId,
  onSelectPlate,
  selectedLineRanges,
  previewLine,
  previewProbePoint,
  playhead,
  progress,
  showRapids,
  showStock,
  view,
  resetKey,
  zoom,
  onZoomChange,
  arrangement,
  onArrange,
  problems,
  shownProblem,
  onSelectProblem,
}: Props) {
  const container = useRef<HTMLDivElement>(null)
  const labels = useRef(new Map<string, HTMLButtonElement>())
  const problemMarkers = useRef(new Map<string, HTMLElement>())
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
    }
    const scene = BedScene.create(
      container.current,
      labels.current,
      problemMarkers.current,
      {
        selectPlate: (id) => select.current(id),
        zoomChange: (value) => zoomChange.current?.(value),
        error: setError,
        arrange: arrangeEvents,
      },
      (id) => models.mesh(id)
    )
    if (!scene) {
      setError("3D view unavailable.")
      return
    }
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
      previewLine,
      previewProbePoint,
      progress,
      showRapids,
      showStock,
      problems,
      shownProblem,
    })
  }, [
    selectedPlateId,
    selectedLineRanges,
    previewLine,
    previewProbePoint,
    progress,
    showRapids,
    showStock,
    problems,
    shownProblem,
  ])
  // Playback moves the playhead every frame: the scene follows it without a render here.
  useEffect(() => {
    if (!playhead) return
    const follow = () => sceneRef.current?.setPlayhead(playhead.get())
    follow()
    const unsubscribe = playhead.subscribe(follow)
    return () => {
      unsubscribe()
      sceneRef.current?.setPlayhead(null)
    }
  }, [playhead])
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

  return (
    <div
      className="absolute inset-0 overflow-hidden [&>canvas]:block"
      ref={container}
      aria-label="Interactive 3D plates and NC toolpaths"
    >
      <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden">
        {plates.map((plate, index) => {
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
      </div>
      {error && (
        <div className="absolute bottom-4 left-4 rounded-md border bg-background px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}
