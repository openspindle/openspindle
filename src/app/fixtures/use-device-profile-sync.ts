import { useEffect, useEffectEvent } from "react"
import { machineId } from "@/machine/contract"
import { useDocumentState, usePersistence } from "@/persistence/persistence"
import { useMachineSnapshot } from "@/platform/machine"
import { followDeviceAnchors } from "../workspace/project-session"
import { useWorkspace, useWorkspaceStore } from "../workspace/workspace-context"
import { useFixtureLibraryStore } from "./fixture-context"

/**
 * Follows the connected device: its fixture profile is created and selected, anchors read
 * from its configuration are recorded there, and every plate moves to it and follows them, as
 * soon as they are read and whenever a plate is opened or added while it is connected.
 * Runs once the fixture library is loaded, so nothing it records is replaced by hydration.
 */
export function useDeviceProfileSync() {
  const persistence = usePersistence()
  const fixtures = useFixtureLibraryStore()
  const workspace = useWorkspaceStore()
  const machine = useMachineSnapshot()
  const device = machine.connection.device
  const configuration = machine.anchors.value
  const fixturesState = useDocumentState(persistence.fixtures)
  const ready = fixturesState.phase !== "loading"
  const deviceKey = device ? machineId(device) : null
  // A plate set up for another device, or with other anchors, is one to move.
  const anchorsKey =
    deviceKey && Object.hasOwn(fixtures.state.profiles, deviceKey)
      ? JSON.stringify(fixtures.state.profiles[deviceKey].anchors)
      : null
  const behind = useWorkspace((state) =>
    state.plates.some(
      (plate) =>
        plate.setup.deviceId !== deviceKey ||
        JSON.stringify(plate.setup.anchors) !== anchorsKey
    )
  )

  const synchronize = useEffectEvent(() => {
    if (!device) return
    fixtures.adoptDevice(device)
    if (!configuration) return
    fixtures.recordDeviceAnchors(device, configuration)
    const id = machineId(device)
    const anchors = Object.hasOwn(fixtures.state.profiles, id)
      ? fixtures.state.profiles[id].anchors
      : undefined
    if (
      anchors?.source === "firmware-config" &&
      anchors.fetchedAt === configuration.fetchedAt
    )
      followDeviceAnchors(workspace, id, anchors, true)
  })

  useEffect(() => {
    if (ready) synchronize()
  }, [
    ready,
    deviceKey,
    configuration?.fetchedAt,
    fixturesState.generation,
    behind,
  ])
}
