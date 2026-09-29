import { useDispatch } from "@/app/workspace/workspace-context"
import { BedViewer } from "@/components/workspace/bed-viewer"
import {
  ViewerToolbar,
  useViewerCamera,
} from "@/features/viewer/viewer-toolbar"
import { useWorkspaceViewerPlates } from "@/features/viewer/workspace-viewer-plates"
import type { JobSubject } from "./job-view"
import type { PlayheadSource } from "@/components/workspace/bed-viewer"
import type { TimelinePreview } from "./use-job-timeline"

/** The 3D bed with every plate; the shown plate is highlighted and drawn up to the preview. */
export function JobViewer({
  shown,
  preview,
  playhead,
}: {
  shown: JobSubject | null
  preview: TimelinePreview
  /** Where simulated playback is, which the view follows every frame. */
  playhead: PlayheadSource
}) {
  const plates = useWorkspaceViewerPlates(shown)
  const dispatch = useDispatch()
  const camera = useViewerCamera()
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <BedViewer
        plates={plates}
        selectedPlateId={shown?.plate.id ?? null}
        onSelectPlate={(plateId) => dispatch({ type: "plate.select", plateId })}
        previewLine={preview.line}
        previewProbePoint={preview.probePoint}
        playhead={playhead}
        progress={preview.segmentProgress}
        showRapids={false}
        showStock
        view={camera.view}
        resetKey={camera.resetKey}
        zoom={camera.zoom}
        onZoomChange={camera.setZoom}
      />
      <ViewerToolbar camera={camera} />
    </div>
  )
}
