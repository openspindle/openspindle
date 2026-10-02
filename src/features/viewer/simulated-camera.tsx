import { useMemo } from "react"
import { cn } from "cn"
import { bedPositionOf } from "@/app/workspace/machine-program"
import { BedViewer } from "@/components/workspace/bed-viewer"
import type {
  LiveTool,
  PlayheadSource,
} from "@/components/workspace/bed-viewer"
import { kitForSetup } from "@/domain/fixtures/catalog"
import {
  useCachedConfiguration,
  useFreshTelemetry,
  useMachineSnapshot,
} from "@/platform/machine"
import { useWorkspaceViewerPlates } from "./workspace-viewer-plates"
import type { ShownPlate } from "./workspace-viewer-plates"

const NO_SELECTION = () => {}
const NO_SETUP = { deviceId: null, fixtures: [] }

/**
 * What the machine's camera would see, on the simulator: the plate on its bed through the
 * camera's lens, the bed moved along Y under it as the machine moves it, with the tool the
 * machine reports where it reports it. Following a job, the playhead that follows the machine
 * shows the tool and the path cut so far instead. Its picture has the shape the device's
 * configuration sets for the camera's stream, once the configuration has been read. Only to
 * look at.
 */
export function SimulatedCamera({
  shown,
  playhead,
}: {
  shown: ShownPlate | null
  /** Where the machine is along the shown plate's moves, while a job there is followed. */
  playhead?: PlayheadSource
}) {
  const drawn = useWorkspaceViewerPlates(shown)
  const plate = shown?.plate ?? null
  const plates = useMemo(
    () => drawn.filter((item) => item.id === plate?.id),
    [drawn, plate?.id]
  )
  const telemetry = useFreshTelemetry()
  const machine = telemetry?.machine
  const tool = telemetry?.tool ?? null
  const offset = telemetry?.toolOffset ?? 0
  const [x, y, z] = machine ? [machine.x, machine.y, machine.z] : []
  const liveTool = useMemo((): LiveTool | null => {
    if (!plate || x === undefined || y === undefined || z === undefined)
      return null
    // The tool's tip: its offset from the tool work Z was set with, which the bed is placed by.
    const position = bedPositionOf(plate, [x, y, z - offset])
    return position && { plateId: plate.id, tool, position }
  }, [plate, x, y, z, offset, tool])
  const { connection } = useMachineSnapshot()
  const picture = useCachedConfiguration(connection.id)?.cameraPicture
  const camera = kitForSetup(plate?.setup ?? NO_SETUP).camera
  let aspect = camera?.aspect
  if (camera && picture) aspect = picture.width / picture.height
  return (
    <div className="pointer-events-none absolute inset-0 flex justify-center">
      {/* The camera's picture, as its stream is shown: with bars at its sides when narrower. */}
      <div
        className={cn("relative h-full max-w-full", !aspect && "w-full")}
        style={{ aspectRatio: aspect }}
      >
        <BedViewer
          plates={plates}
          selectedPlateId={plate?.id ?? null}
          onSelectPlate={NO_SELECTION}
          progress={100}
          playhead={playhead}
          showRapids={false}
          showStock
          view="camera"
          resetKey={0}
          zoom={1}
          liveTool={liveTool}
          labeled={false}
        />
      </div>
    </div>
  )
}
