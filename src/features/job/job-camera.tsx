import { useState } from "react"
import { Camera, Minus, ZoomIn, ZoomOut } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { PlayheadSource } from "@/components/workspace/bed-viewer"
import {
  CameraFeedButton,
  DeviceCamera,
} from "@/components/workspace/device-camera"
import { SimulatedCamera } from "@/features/viewer/simulated-camera"
import { useMachineSnapshot } from "@/platform/machine"
import type { JobSubject } from "./job-view"

/** A choice kept across launches, like the panel layouts. */
function useStoredFlag(key: string) {
  const [value, setValue] = useState(() => localStorage.getItem(key) === "true")
  const setStored = (next: boolean) => {
    localStorage.setItem(key, String(next))
    setValue(next)
  }
  return [value, setStored] as const
}

/**
 * The machine camera at the top right of the Job tab's 3D view, while a machine with a camera is
 * connected; on the simulator, the shown plate as its camera would see it, with the tool at the
 * playhead while a job there is followed. Zoomed, it is twice
 * the size. Minimized, it leaves a button where Minimize was that shows it again, and a started
 * stream resumes.
 */
export function JobCamera({
  shown,
  playhead,
}: {
  shown: JobSubject | null
  /** Where the machine is along the shown plate's moves, while its job is followed. */
  playhead?: PlayheadSource
}) {
  const { connection, features } = useMachineSnapshot()
  const [minimized, setMinimized] = useStoredFlag(
    "openspindle:job-camera-minimized"
  )
  const [zoomed, setZoomed] = useStoredFlag("openspindle:job-camera-zoomed")
  if (!connection.device || features?.camera !== true) return null
  return (
    <>
      {minimized && (
        <Card className="absolute top-5 right-5 z-10 p-1 shadow-lg">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label="Show camera"
            title="Show camera"
            onClick={() => setMinimized(false)}
          >
            <Camera />
          </Button>
        </Card>
      )}
      <DeviceCamera
        device={connection.device}
        available
        variant="overlay"
        hidden={minimized}
        simulated={<SimulatedCamera shown={shown} playhead={playhead} />}
        className={cn(
          "absolute top-4 right-4 z-10 max-w-[calc(100%-6rem)] shadow-lg",
          zoomed ? "w-160" : "w-80"
        )}
        actions={
          <>
            <CameraFeedButton
              aria-label={zoomed ? "Zoom out camera" : "Zoom in camera"}
              title={zoomed ? "Zoom out" : "Zoom in"}
              onClick={() => setZoomed(!zoomed)}
            >
              {zoomed ? <ZoomOut /> : <ZoomIn />}
            </CameraFeedButton>
            <CameraFeedButton
              aria-label="Minimize camera"
              title="Minimize"
              onClick={() => setMinimized(true)}
            >
              <Minus />
            </CameraFeedButton>
          </>
        }
      />
    </>
  )
}
