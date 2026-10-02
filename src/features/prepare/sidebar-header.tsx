import { ChevronRight, Cpu, Plus, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card"
import { EmptyMedia } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import {
  useFixtureLibrary,
  useFixtureLibraryStore,
} from "@/app/fixtures/fixture-context"
import { bedSetupPlacement } from "@/app/fixtures/fixture-library-store"
import { Hint } from "@/components/workspace/hint"
import { bedSetupAnchorsOf } from "@/domain/anchors/stored-anchors"
import {
  useSelectedPlate,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { kitForDevice } from "@/domain/fixtures/catalog"
import {
  WORKSPACE_PROFILE,
  bedSetupOf,
  defaultFixtureProfile,
} from "@/domain/fixtures/profiles"
import { newId } from "@/domain/primitives"
import { openDialog } from "@/features/shell/dialogs"
import { useMachineSnapshot } from "@/platform/machine"

/** The connected machine at a glance; opens the device picker. */
export function DeviceCard() {
  const { device, restarting } = useMachineSnapshot().connection
  const imageUrl = device ? kitForDevice(device.model)?.imageUrl : undefined
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-0">
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-3 p-3 text-left"
          onClick={() => openDialog({ kind: "device" })}
        >
          <EmptyMedia variant="icon" className="mb-0 size-12">
            {imageUrl ? (
              <img src={imageUrl} alt="" className="size-full object-contain" />
            ) : (
              <Cpu className="size-7" />
            )}
          </EmptyMedia>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle>
              {device?.name ?? (restarting ? "Restarting…" : "Connect device")}
            </CardTitle>
            {device && <CardDescription>{device.host}</CardDescription>}
          </div>
          <ChevronRight />
        </Button>
      </CardContent>
    </Card>
  )
}

const BED_SETUP_HINT =
  "One of the plate's device's bed setups (Device → Bed setup): its bed, fixtures and anchors, which the plate follows. Choosing one sets the plate up on it."

/**
 * The bed setup of its device the selected plate is set up on: choosing another sets it up on
 * that one (its fixtures, the plate's locked ones aside, and its anchors), and applying it again
 * catches up with its fixtures. A plate set up on a bed setup this computer does not have, such
 * as on another computer, can add it to its device's profile.
 */
export function BedSetupField() {
  const workspace = useWorkspaceStore()
  const fixtureLibrary = useFixtureLibraryStore()
  const plate = useSelectedPlate()
  const profiles = useFixtureLibrary((library) => library.profiles)
  const setup = plate?.setup ?? null
  // The plate's own device, not whichever one the Device tab shows.
  const profileId = setup?.deviceId ?? WORKSPACE_PROFILE
  const profile = Object.hasOwn(profiles, profileId)
    ? profiles[profileId]
    : defaultFixtureProfile()
  // A bed setup this computer does not have, such as one the plate was set up on elsewhere.
  const missing =
    setup?.bedSetupId &&
    !profile.bedSetups.some((item) => item.id === setup.bedSetupId)
      ? setup.bedSetupId
      : null
  const bedSetup = bedSetupOf(profile, setup?.bedSetupId)
  const apply = (id: string) => {
    if (!plate) return
    const placement = bedSetupPlacement(profileId, profile, id)
    const result = workspace.dispatch({
      type: "fixtures.useDefaults",
      plateId: plate.id,
      fixtures: placement.fixtures,
      anchors: placement.anchors,
      bedSetupId: placement.bedSetupId ?? null,
    })
    if (!result.ok) toast.error(result.error)
  }
  const keep = () => {
    if (!plate || !setup) return
    fixtureLibrary.keepBedSetup(profileId, {
      id: setup.bedSetupId ?? newId(),
      name: plate.name || "Plate's bed setup",
      definitions: setup.fixtures.map((item) => ({
        ...item.definition,
        defaultEnabled: item.enabled,
        defaultPosition: item.position,
        defaultRotation: item.rotation,
      })),
      anchors: setup.anchors ? bedSetupAnchorsOf(setup.anchors) : [],
    })
  }
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor="bed-setup" className="shrink-0">
        <Hint text={BED_SETUP_HINT}>Bed setup</Hint>
      </FieldLabel>
      <OptionSelect
        id="bed-setup"
        aria-description={BED_SETUP_HINT}
        className="min-w-0 flex-1"
        options={[
          ...profile.bedSetups.map((item) => ({
            value: item.id,
            label: item.name,
          })),
          ...(missing
            ? [
                {
                  value: missing,
                  label: "Not on this computer",
                  disabled: true,
                },
              ]
            : []),
        ]}
        value={missing ?? bedSetup.id}
        disabled={!plate}
        onValueChange={apply}
      />
      {!missing ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Apply bed setup again"
          title="Apply bed setup again: its fixtures as they are now"
          disabled={!plate}
          onClick={() => apply(bedSetup.id)}
        >
          <RotateCcw />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add bed setup"
          title="Add the plate's bed setup to its device"
          onClick={keep}
        >
          <Plus />
        </Button>
      )}
    </Field>
  )
}
