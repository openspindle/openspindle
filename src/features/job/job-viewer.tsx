import { DEFAULT_VIEWER_LAYERS } from "@/components/workspace/viewer/viewer-input"
import { ViewerLayersMenu } from "./viewer-layers-menu"
import type { FrameSource } from "@/app/job/frame"
import { useMemo, useState } from "react"
import { useMaterialRemoval } from "@/features/workshop/use-material-removal"
import { useDispatch, useWorkspace } from "@/app/workspace/workspace-context"
import { BedViewer } from "@/components/workspace/bed-viewer"
import {
  ViewerToolbar,
  useViewerCamera,
} from "@/features/viewer/viewer-toolbar"
import { useVisualStyle } from "@/features/viewer/visual-style"
import { useWorkspaceViewerPlates } from "@/features/viewer/workspace-viewer-plates"
import type { JobSubject } from "./job-view"
import { useFreshTelemetry } from "@/platform/machine"
import { MachineOriginCard, useMachineOrigin } from "./machine-origin"
import { MachineStatusCard } from "./machine-status"
import { TrackerOverlay } from "./tracker-overlay"

/**
 * The 3D bed with every plate; the shown plate is highlighted and drawn at the timeline's frames,
 * with where the connected machine keeps work zero.
 */
export function JobViewer({
  shown,
  frames,
}: {
  shown: JobSubject | null
  /** The frames of the shown plate's plan the view follows every frame on its own. */
  frames: FrameSource
}) {
  const originalPlates = useWorkspaceViewerPlates(shown)
  const workspacePlates = useWorkspace((state) => state.plates)
  const editingPlate = workspacePlates.find(
    (plate) => plate.id === shown?.plate.id
  )
  const operations = editingPlate?.operations ?? shown?.plate.operations ?? []
  const [layers, setLayers] = useState(DEFAULT_VIEWER_LAYERS)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const hiddenLineRanges = useMemo(() => {
    if (!shown) return {}
    return {
      [shown.plate.id]: shown.compiled.spans
        .filter((span) => hidden.has(span.operationId))
        .map((span) => ({ start: span.startLine, end: span.endLine })),
    }
  }, [shown, hidden])
  const plates = useMemo(
    () =>
      originalPlates.map((plate) => {
        if (!shown || plate.id !== shown.plate.id) return plate
        return {
          ...plate,
          operationColors: shown.compiled.spans.flatMap((span) => {
            const color = (editingPlate ?? shown.plate).operations.find(
              (operation) => operation.id === span.operationId
            )?.displayColor
            return color
              ? [{ startLine: span.startLine, endLine: span.endLine, color }]
              : []
          }),
        }
      }),
    [originalPlates, shown, editingPlate]
  )
  const [showRemoval, setShowRemoval] = useState(false)
  const removal = useMaterialRemoval(
    shown,
    frames,
    showRemoval,
    layers.deviation
  )
  const dispatch = useDispatch()
  const camera = useViewerCamera()
  const [style] = useVisualStyle()
  const telemetry = useFreshTelemetry()
  const machineOrigin = useMachineOrigin(shown?.plate ?? null, telemetry)
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <BedViewer
        removal={
          shown && removal.grid
            ? { plateId: shown.plate.id, grid: removal.grid }
            : null
        }
        plates={plates}
        selectedPlateId={shown?.plate.id ?? null}
        onSelectPlate={(plateId) => dispatch({ type: "plate.select", plateId })}
        frames={frames}
        layers={layers}
        hiddenLineRanges={hiddenLineRanges}
        showRapids={layers.rapids}
        showStock={layers.stock}
        view={camera.view}
        style={style}
        resetKey={camera.resetKey}
        zoom={camera.zoom}
        onZoomChange={camera.setZoom}
        machineOrigin={machineOrigin}
      />
      <ViewerToolbar camera={camera} />
      <ViewerLayersMenu
        layers={layers}
        change={(key, value) =>
          setLayers((current) => ({ ...current, [key]: value }))
        }
        showRemoval={showRemoval}
        setShowRemoval={setShowRemoval}
        removal={removal}
        operations={operations}
        hidden={hidden}
        editable={!!editingPlate}
        setVisible={(id, visible) =>
          setHidden((current) => {
            const next = new Set(current)
            if (visible) next.delete(id)
            else next.add(id)
            return next
          })
        }
        setColor={(operationId, color) => {
          if (editingPlate)
            dispatch({
              type: "operation.color",
              plateId: editingPlate.id,
              operationId,
              color,
            })
        }}
      />
      <TrackerOverlay />
      <div className="absolute right-4 bottom-4 z-10 flex flex-col gap-2">
        <MachineStatusCard telemetry={telemetry} />
        <MachineOriginCard
          telemetry={telemetry}
          origin={machineOrigin}
          workOrigin={shown?.plate.setup.workOrigin ?? null}
        />
      </div>
    </div>
  )
}
