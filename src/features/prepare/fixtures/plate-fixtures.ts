import { useMemo } from "react"
import { toast } from "sonner"
import { useFixtureLibrary } from "@/app/fixtures/fixture-context"
import type { WorkspaceStore } from "@/app/workspace/store"
import { fixtureInstance, isBedKind } from "@/domain/fixtures/definitions"
import type {
  FixtureDefinition,
  FixtureKind,
} from "@/domain/fixtures/definitions"
import {
  WORKSPACE_PROFILE,
  bedSetupOf,
  defaultFixtureProfile,
} from "@/domain/fixtures/profiles"
import type { BedSetup } from "@/domain/fixtures/profiles"
import type { Plate } from "@/domain/plate/plate"
import { selectSetupItem } from "../arrange/arrange-state"

/** Fixture kinds as fixtures are offered: grouped, in this order. */
export const FIXTURE_KIND_GROUPS: readonly (readonly [FixtureKind, string])[] =
  [
    ["bed", "Beds"],
    ["wasteboard", "Wasteboards"],
    ["clamp", "Clamps"],
    ["holder", "Holders"],
    ["vise", "Vises"],
    ["vacuum-bed", "Vacuum beds"],
    ["rotary", "Rotary modules"],
    ["other", "Other"],
  ]

/**
 * The bed setup a plate adds fixtures from: of the plate's own device, not whichever one the
 * Device tab currently shows.
 */
export function usePlateBedSetup(plate: Plate): BedSetup {
  const profiles = useFixtureLibrary((library) => library.profiles)
  const profileId = plate.setup.deviceId ?? WORKSPACE_PROFILE
  const { bedSetupId } = plate.setup
  return useMemo(() => {
    const profile = Object.hasOwn(profiles, profileId)
      ? profiles[profileId]
      : defaultFixtureProfile()
    return bedSetupOf(profile, bedSetupId)
  }, [profiles, profileId, bedSetupId])
}

/**
 * Adds a fixture of `definition` to the plate and selects it in the viewer, so it can be moved
 * into place right away; a bed replaces the plate's bed, and a bed the plate had already stays
 * its bed and is selected instead. A refusal is shown; returns whether it was added.
 */
export function addFixtureToPlate(
  workspace: WorkspaceStore,
  plateId: string,
  definition: FixtureDefinition
): boolean {
  const added = fixtureInstance(definition)
  const result = workspace.dispatch({
    type: "fixture.add",
    plateId,
    fixture: added,
  })
  if (!result.ok) {
    toast.error(result.error)
    return false
  }
  const fixtures =
    result.value.plates.find(({ id }) => id === plateId)?.setup.fixtures ?? []
  const selected =
    fixtures.find((item) => item.id === added.id) ??
    fixtures.find(
      (item) =>
        isBedKind(item.definition.kind) && item.definition.id === definition.id
    )
  if (selected)
    selectSetupItem(
      { plateId, item: { kind: "fixture", id: selected.id } },
      !isBedKind(definition.kind)
    )
  return true
}
