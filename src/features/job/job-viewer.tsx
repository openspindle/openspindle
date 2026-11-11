import type { FrameSource } from "@/app/job/frame"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useMaterialRemoval } from "@/features/workshop/use-material-removal"
import { useDispatch } from "@/app/workspace/workspace-context"
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
  const plates = useWorkspaceViewerPlates(shown)
  const [showRemoval, setShowRemoval] = useState(false)
  const removal = useMaterialRemoval(shown, frames, showRemoval)
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
        showRapids={false}
        showStock
        view={camera.view}
        style={style}
        resetKey={camera.resetKey}
        zoom={camera.zoom}
        onZoomChange={camera.setZoom}
        machineOrigin={machineOrigin}
      />
      <ViewerToolbar camera={camera} />
      <Card
        size="sm"
        className="absolute top-4 right-4 z-10 max-w-72 gap-2 p-3"
      >
        <Button
          variant={showRemoval ? "secondary" : "outline"}
          size="sm"
          aria-pressed={showRemoval}
          onClick={() => setShowRemoval((value) => !value)}
        >
          Material removal · {showRemoval ? "On" : "Off"}
        </Button>
        {showRemoval && (
          <>
            <p className="text-muted-foreground">
              Sampled stock model at the playback cursor. No undercuts, fixture
              collisions or physical verification.
            </p>
            {removal.pending && <p>Updating sampled stock…</p>}
            {removal.problem && <p>{removal.problem}</p>}
            {removal.grid && (
              <p className="font-numeric">
                Grid spacing up to {removal.grid.resolution.toFixed(2)} mm.
                Narrow details may disappear.
              </p>
            )}
          </>
        )}
      </Card>
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
