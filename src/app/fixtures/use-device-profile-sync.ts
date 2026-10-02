import { useEffect, useEffectEvent } from "react"
import { machineId } from "@/machine/contract"
import { useDocumentState, usePersistence } from "@/persistence/persistence"
import { useMachineSnapshot } from "@/platform/machine"
import {
  followDeviceAnchors,
  followDeviceBed,
} from "../workspace/project-session"
import { useWorkspace, useWorkspaceStore } from "../workspace/workspace-context"
import { plateAnchors } from "@/domain/plate/bed-setup"
import { useFixtureLibrary, useFixtureLibraryStore } from "./fixture-context"
import { profileAnchors, profilePlacement } from "./fixture-library-store"

/**
 * Follows the connected device: its fixture profile is created and selected, and the empty plate
 * a project starts with is set up on its bed at once (`followDeviceBed`). Anchors read from its
 * configuration are recorded there (with the bed setups' anchors it stores, once its profile has
 * it store them), and every plate moves to it and follows them, as soon as they are read and
 * whenever a plate is opened or added while it is connected.
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
  const storesAnchors = useFixtureLibrary(
    (library) =>
      deviceKey !== null &&
      Object.hasOwn(library.profiles, deviceKey) &&
      !!library.profiles[deviceKey].storeAnchors
  )
  // A plate set up for another device, or with other anchors, is one to move.
  const profile =
    deviceKey && Object.hasOwn(fixtures.state.profiles, deviceKey)
      ? profileAnchors(deviceKey, fixtures.state.profiles[deviceKey])
      : null
  const behind = useWorkspace((state) =>
    state.plates.some(
      (plate) =>
        plate.setup.deviceId !== deviceKey ||
        !profile ||
        JSON.stringify(plate.setup.anchors) !==
          JSON.stringify(
            plateAnchors(plate.setup, profile.anchors, profile.bedSetups)
          )
    )
  )

  const synchronize = useEffectEvent(() => {
    if (!device) return
    fixtures.adoptDevice(device)
    followDeviceBed(workspace, profilePlacement(fixtures.state))
    if (!configuration) return
    fixtures.recordDeviceAnchors(device, configuration)
    const id = machineId(device)
    const recorded = Object.hasOwn(fixtures.state.profiles, id)
      ? profileAnchors(id, fixtures.state.profiles[id])
      : null
    if (
      recorded?.anchors.source === "firmware-config" &&
      recorded.anchors.fetchedAt === configuration.fetchedAt
    )
      followDeviceAnchors(workspace, recorded, true)
  })

  useEffect(() => {
    if (ready) synchronize()
  }, [
    ready,
    deviceKey,
    configuration?.fetchedAt,
    fixturesState.generation,
    behind,
    storesAnchors,
  ])
}
