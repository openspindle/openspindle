import { toast } from "sonner"
import {
  useFixtureLibrary,
  useFixtureLibraryStore,
  useSelectedFixtureProfile,
} from "@/app/fixtures/fixture-context"
import { followDeviceAnchors } from "@/app/workspace/project-session"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import type { AnchorXY } from "@/domain/anchors/stored-anchors"
import { openDialog } from "@/features/shell/dialogs"
import { isFresh, machineId } from "@/machine/contract"
import {
  useMachineSnapshot,
  useReadAnchors,
  useWriteAnchors,
} from "@/platform/machine"
import type { AnchorWriting } from "./anchor-positions-form"
import { DeviceAnchors } from "./device-anchors"
import { DeviceFixtures } from "./device-fixtures"
import { DeviceConfigurationCard } from "./device-configuration"
import { DevicePanel } from "./device-panel"
import { HeightMapCard } from "./height-map"
import { useDeviceHeightMap } from "./height-map-dialog"
import { ReadAnchorsButton } from "./read-anchors-button"

/**
 * The machine: connection, controls, camera, anchors, fixtures and the measured height map.
 * Anchors are read on connecting; reading them again and writing their positions happen here.
 */
export function DevicePage() {
  const machine = useMachineSnapshot()
  const readAnchors = useReadAnchors()
  const writeAnchors = useWriteAnchors()
  const fixtures = useFixtureLibraryStore()
  const profiles = useFixtureLibrary((library) => library.profiles)
  const selectedId = useFixtureLibrary((library) => library.selectedId)
  const { profile, deviceId } = useSelectedFixtureProfile()
  const workspace = useWorkspaceStore()
  const { map } = useDeviceHeightMap()
  // A connected machine that stores no anchors has none to read; its kit may still place some.
  const storesAnchors = machine.features?.anchors !== false
  const telemetry = isFresh(machine.telemetry, Date.now())
    ? machine.telemetry
    : null
  const current: AnchorXY | null = telemetry?.machine
    ? [telemetry.machine.x, telemetry.machine.y]
    : null
  const entry = machine.availability.writeAnchors
  const device = machine.connection.device
  const read = machine.anchors.value
  // Edits start from the anchors shown, so they must be what the connected device stores now:
  // its own, as read since it connected, never another device's or the defaults.
  let reason = entry.allowed ? null : (entry.reason ?? "Unavailable.")
  if (!reason && device && deviceId !== machineId(device))
    reason = `These are another device's anchors. Choose ${device.name} as the Fixtures device to edit its own.`
  else if (!reason && (!read || profile.anchors?.fetchedAt !== read.fetchedAt))
    reason = "Read the anchors first."
  const writing: AnchorWriting = {
    reason,
    writing: writeAnchors.isPending,
    current,
    onWrite: (anchors, done) =>
      writeAnchors.mutate(
        { anchors },
        {
          onSuccess: ({ afterRestart }) => {
            done()
            toast.success("Anchors written to the device.", {
              description: afterRestart
                ? "Reset the machine for its own moves to use them."
                : undefined,
            })
          },
          onError: (error) => toast.error(error.message),
        }
      ),
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <DevicePanel
        openPicker={() => openDialog({ kind: "device" })}
        fixturePanel={
          <>
            <DeviceConfigurationCard />
            <HeightMapCard
              map={map}
              onOpen={() => openDialog({ kind: "height-map" })}
            />
            <DeviceAnchors
              setup={profile.anchors}
              loading={machine.anchors.reading}
              error={machine.anchors.error ?? undefined}
              action={
                storesAnchors && (
                  <ReadAnchorsButton
                    reading={readAnchors.isPending}
                    onRead={() =>
                      readAnchors.mutate(undefined, {
                        onSuccess: () =>
                          toast.success("Stored anchors updated."),
                        onError: (error) => toast.error(error.message),
                      })
                    }
                  />
                )
              }
              writing={storesAnchors ? writing : undefined}
              onAlign={(anchor1BedPosition) => {
                if (!profile.anchors) return
                const anchors = { ...profile.anchors, anchor1BedPosition }
                fixtures.setAnchors(anchors)
                followDeviceAnchors(workspace, deviceId, anchors)
              }}
            />
            <DeviceFixtures
              definitions={profile.definitions}
              onChange={(definitions) => fixtures.setDefinitions(definitions)}
              profiles={profiles}
              selectedId={selectedId}
              onProfileChange={(id) => fixtures.select(id)}
            />
          </>
        }
      />
    </div>
  )
}
