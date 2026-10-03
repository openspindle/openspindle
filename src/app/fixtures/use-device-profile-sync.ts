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
import { profileAnchors } from "./fixture-library-store"
import { WORKSPACE_PROFILE } from "@/domain/fixtures/profiles"
import {
  adoptedProfileConnection,
  rememberProfileConnection,
} from "./connection-profile"

/**
 * Adopts the connected device's profile once per connection, before reading its anchors.
 * Later reads update only plates still assigned to it; choosing another profile or opening
 * a project during that connection keeps its assignments.
 * Runs once the fixture library is loaded, so nothing it records is replaced by hydration.
 */
export function useDeviceProfileSync() {
  const persistence = usePersistence()
  const fixtures = useFixtureLibraryStore()
  const workspace = useWorkspaceStore()
  const machine = useMachineSnapshot()
  const { id: connectionId, status } = machine.connection
  const device = machine.connection.device
  const configuration = machine.anchors.value
  const fixturesState = useDocumentState(persistence.fixtures)
  const ready = fixturesState.phase !== "loading"
  const deviceKey = device ? machineId(device) : null
  const projectDeviceId = useWorkspace(
    (state) => state.project.profile.deviceId
  )
  const selectedId = useFixtureLibrary((library) => library.selectedId)
  const deviceProfile = useFixtureLibrary(
    (library) =>
      deviceKey !== null &&
      Object.hasOwn(library.profiles, deviceKey) &&
      library.profiles[deviceKey]
  )
  // Only assigned plates follow these anchors; another profile is an explicit choice.
  const profile =
    deviceKey && deviceProfile ? profileAnchors(deviceKey, deviceProfile) : null
  const behind = useWorkspace((state) =>
    state.plates.some(
      (plate) =>
        plate.setup.deviceId === deviceKey &&
        profile !== null &&
        JSON.stringify(plate.setup.anchors) !==
          JSON.stringify(
            plateAnchors(plate.setup, profile.anchors, profile.bedSetups)
          )
    )
  )

  const synchronize = useEffectEvent(() => {
    if (!device || !connectionId || status !== "connected") return
    if (adoptedProfileConnection(workspace) !== connectionId) {
      rememberProfileConnection(workspace, connectionId)
      fixtures.adoptDevice(device)
      const id = machineId(device)
      followDeviceBed(
        workspace,
        id,
        fixtures.state.profiles[id],
        fixtures.state.definitions
      )
    }
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
      followDeviceAnchors(workspace, recorded)
  })

  const alignSelection = useEffectEvent(() => {
    const id = workspace.state.project.profile.deviceId ?? WORKSPACE_PROFILE
    if (
      fixtures.state.selectedId !== id &&
      Object.hasOwn(fixtures.state.profiles, id)
    )
      fixtures.select(id)
  })

  useEffect(() => {
    if (ready) synchronize()
  }, [
    ready,
    connectionId,
    status,
    deviceKey,
    configuration?.fetchedAt,
    fixturesState.generation,
    behind,
    deviceProfile,
  ])
  useEffect(() => {
    if (ready) alignSelection()
  }, [ready, projectDeviceId, selectedId, fixturesState.generation])
}
