import { useState } from "react"
import { useIsMutating } from "@tanstack/react-query"
import { Crosshair } from "lucide-react"
import { toast } from "sonner"
import { ReasonButton } from "@/components/workspace/reason-button"
import {
  useFixtureLibrary,
  useFixtureLibraryStore,
  useSelectedFixtureProfile,
} from "@/app/fixtures/fixture-context"
import {
  profileAnchors,
  selectedProfile,
} from "@/app/fixtures/fixture-library-store"
import {
  retryStoredAnchors,
  useStoredAnchorsFailure,
} from "@/app/fixtures/use-stored-anchors-sync"
import { followDeviceAnchors } from "@/app/workspace/project-session"
import { deviceAnchorsOf } from "@/domain/anchors/stored-anchors"
import { bedSetupOf } from "@/domain/fixtures/profiles"
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
import { DeviceBedSetup } from "./device-bed-setup"
import { useProbeAnchor } from "./use-probe-anchor"
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
  const probeAnchor = useProbeAnchor()
  const storedAnchorsFailure = useStoredAnchorsFailure()
  // The bed setups' anchors are written in the background too (`useStoredAnchorsSync`).
  const writingAnchors =
    useIsMutating({ mutationKey: ["machine", "writeAnchors"] }) > 0
  // The bed setup shown, the profile's default one until another is chosen.
  const [shownBedSetup, setShownBedSetup] = useState<string | null>(null)
  const bedSetup = bedSetupOf(profile, shownBedSetup)
  /** Plates set up for the shown profile's device follow its anchors and its bed setups'. */
  const follow = () => {
    const { selectedId: id } = fixtures.state
    const anchors = profileAnchors(id, selectedProfile(fixtures.state))
    if (anchors) followDeviceAnchors(workspace, anchors)
  }
  // A connected machine that stores no anchors has none to read; its kit may still place some.
  const storesAnchors = machine.features?.anchors !== false
  const telemetry = isFresh(machine.telemetry, Date.now())
    ? machine.telemetry
    : null
  const current: AnchorXY | null = telemetry?.machine
    ? [telemetry.machine.x, telemetry.machine.y]
    : null
  // Where the machine is from the shown device's first anchor, to keep as a bed setup's anchor.
  const first = profile.anchors ? deviceAnchorsOf(profile.anchors)[0] : null
  const shownConnected =
    !!machine.connection.device &&
    deviceId === machineId(machine.connection.device)
  const currentFromAnchor =
    first && current && shownConnected
      ? {
          position: [
            current[0] - first.machinePosition[0],
            current[1] - first.machinePosition[1],
          ] as AnchorXY,
        }
      : {
          reason: shownConnected
            ? "The machine's position is not known."
            : "Connect this device to take where it is.",
        }
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
    writing: writingAnchors,
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
                <>
                  <ReasonButton
                    label="Probe anchor"
                    variant="outline"
                    size="sm"
                    reason={probeAnchor.reason}
                    onClick={probeAnchor.run}
                  >
                    <Crosshair data-icon="inline-start" />
                    Probe anchor
                  </ReasonButton>
                  {storesAnchors && (
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
                  )}
                </>
              }
              writing={storesAnchors ? writing : undefined}
              storing={
                storesAnchors && deviceId
                  ? {
                      enabled: !!profile.storeAnchors,
                      onChange: (enabled) => {
                        retryStoredAnchors()
                        fixtures.setStoreAnchors(enabled)
                      },
                      failed: storedAnchorsFailure && {
                        error: storedAnchorsFailure.error,
                        onRetry: retryStoredAnchors,
                      },
                    }
                  : undefined
              }
              onAlign={(bedOffset) => {
                if (!profile.anchors) return
                fixtures.setAnchors({ ...profile.anchors, bedOffset })
                follow()
              }}
            />
            <DeviceBedSetup
              profiles={profiles}
              selectedId={selectedId}
              onProfileChange={(id) => {
                fixtures.select(id)
                setShownBedSetup(null)
              }}
              bedSetups={profile.bedSetups}
              bedSetup={bedSetup}
              defaultBedSetupId={profile.defaultBedSetupId}
              onBedSetupChange={setShownBedSetup}
              deviceAnchors={profile.anchors}
              current={currentFromAnchor}
              onAdd={() => {
                const id = fixtures.addBedSetup(
                  `${bedSetup.name} copy`,
                  bedSetup.id
                )
                if (id) setShownBedSetup(id)
              }}
              onRename={(name) => fixtures.renameBedSetup(bedSetup.id, name)}
              onRemove={() => {
                fixtures.removeBedSetup(bedSetup.id)
                setShownBedSetup(null)
              }}
              onMakeDefault={() => fixtures.setDefaultBedSetup(bedSetup.id)}
              onAnchorsChange={(anchors) => {
                fixtures.setBedSetupAnchors(bedSetup.id, anchors)
                follow()
              }}
            />
            <DeviceFixtures
              definitions={bedSetup.definitions}
              onChange={(definitions) =>
                fixtures.setDefinitions(bedSetup.id, definitions)
              }
              selectedId={selectedId}
            />
          </>
        }
      />
    </div>
  )
}
