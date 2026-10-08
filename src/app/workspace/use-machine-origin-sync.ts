import { useEffect, useEffectEvent } from "react"
import { followedMachineOrigin } from "@/domain/plate/work-origin"
import { isFresh, machineId } from "@/machine/contract"
import { useMachineSnapshot } from "@/platform/machine"
import { followMachineOrigin } from "./project-session"
import { useWorkspace, useWorkspaceStore } from "./workspace-context"

/**
 * Plates on the connected device's machine origin follow where it reports its work zero, while
 * it is idle without a program: a running program may move work zero, and the plate it runs
 * stays where it was. Read device reads the same, with the device's anchors.
 */
export function useMachineOriginSync() {
  const workspace = useWorkspaceStore()
  const { connection, telemetry } = useMachineSnapshot()
  const device = connection.status === "connected" ? connection.device : null
  const deviceKey = device ? machineId(device) : null
  const origin =
    telemetry &&
    isFresh(telemetry, Date.now()) &&
    telemetry.state === "Idle" &&
    telemetry.job === null
      ? telemetry.workOrigin
      : null
  const position = deviceKey && origin ? ([origin.x, origin.y] as const) : null
  const behind = useWorkspace((state) =>
    state.plates.some(
      (plate) =>
        deviceKey !== null &&
        position !== null &&
        followedMachineOrigin(plate, deviceKey, [position[0], position[1]]) !==
          plate
    )
  )

  const follow = useEffectEvent(() => {
    if (deviceKey && position)
      followMachineOrigin(workspace, deviceKey, position)
  })

  useEffect(() => {
    if (behind) follow()
  }, [behind])
}
