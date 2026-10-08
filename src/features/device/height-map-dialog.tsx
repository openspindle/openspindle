import { useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { machineId } from "@/machine/contract"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { HeightMapView } from "./height-map"
import { AppDialog } from "@/features/shell/app-dialog"
import {
  useMachineCommand,
  useMachineSnapshot,
  useReadHeightMap,
} from "@/platform/machine"

/** The height map of the connected device (or the selected plate's), and reading it again. */
export function useDeviceHeightMap() {
  const machine = useMachineSnapshot()
  const device = machine.connection.device
  const deviceId = useWorkspace((state) => {
    if (device) return machineId(device)
    const plate = state.plates.find((item) => item.id === state.selectedPlateId)
    return plate?.setup.deviceId ?? null
  })
  const map = useWorkspace((state) =>
    deviceId !== null && Object.hasOwn(state.heightMaps, deviceId)
      ? state.heightMaps[deviceId]
      : undefined
  )
  return { map, deviceId }
}

const report = (error: Error) => toast.error(error.message)

/**
 * The connected machine's height map, its work Z and whether it still applies the map, which
 * clearing stops. While it applies one, opening reads it, so the map shown is the one it cuts
 * along rather than the one read last.
 */
export function HeightMapDialog({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspaceStore()
  const machine = useMachineSnapshot()
  const read = useReadHeightMap()
  const command = useMachineCommand()
  const { map, deviceId } = useDeviceHeightMap()
  const availability = machine.availability.readHeightMap
  const clear = machine.availability.clearHeightMap
  const telemetry = machine.telemetry
  const { mutateAsync } = read
  const retrieve = useCallback(async () => {
    const result = await mutateAsync()
    workspace.dispatch({ type: "heightMap.store", map: result })
  }, [mutateAsync, workspace])
  const applying = telemetry?.compensation != null
  const readable = availability.allowed && !availability.deferred
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !applying || !readable) return
    opened.current = true
    retrieve().catch(report)
  }, [applying, readable, retrieve])
  return (
    <AppDialog title="Measured heights" width="wide" onClose={onClose}>
      <HeightMapView
        key={deviceId ?? "disconnected"}
        map={map}
        deviceName={machine.connection.device?.name}
        readError={availability.allowed ? null : availability.reason}
        deferred={availability.deferred}
        reading={read.isPending}
        onRetrieve={retrieve}
        applied={
          telemetry && {
            compensation: telemetry.compensation,
            workZ: telemetry.workOrigin?.z ?? null,
            toolOffset: telemetry.toolOffset,
          }
        }
        clearReason={clear.allowed ? null : (clear.reason ?? "Unavailable.")}
        clearing={command.isPending}
        onClear={() =>
          command.mutate({ type: "clearHeightMap" }, { onError: report })
        }
      />
    </AppDialog>
  )
}
