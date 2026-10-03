import {
  WORKSPACE_PROFILE,
  profileBedSetupAnchors,
  profileDeviceId,
} from "@/domain/fixtures/profiles"
import type { FixtureProfile } from "@/domain/fixtures/profiles"
import { plateAnchors } from "@/domain/plate/bed-setup"
import { fail } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import type { ProjectProfile } from "@/domain/workspace/project-profile"
import type { FixtureLibrary } from "@/persistence/fixture-document"
import type { PlatePlacement } from "../workspace/import-program"
import type { WorkspaceStore } from "../workspace/store"
import { bedSetupPlacement } from "./fixture-library-store"
import type { FixtureLibraryStore } from "./fixture-library-store"

export const projectProfileSnapshot = (
  profileId: string,
  profile: FixtureProfile
): ProjectProfile => ({
  deviceId: profileDeviceId(profileId),
  bedSetupId: profile.defaultBedSetupId,
  anchors: profile.anchors ?? null,
  bedSetups: profileBedSetupAnchors(profile),
})

/** New plates follow the project's device, including after Undo or opening another project. */
export function projectPlacement(
  state: WorkspaceState,
  library: FixtureLibrary
): PlatePlacement {
  const target = state.project.profile
  const profileId = target.deviceId ?? WORKSPACE_PROFILE
  if (Object.hasOwn(library.profiles, profileId)) {
    const profile = library.profiles[profileId]
    const placement = bedSetupPlacement(
      profileId,
      profile,
      undefined,
      library.definitions
    )
    if (!placement.anchors && target.anchors)
      return {
        ...placement,
        anchors: plateAnchors(
          { bedSetupId: placement.bedSetupId, anchors: null },
          target.anchors,
          profileBedSetupAnchors(profile)
        ),
      }
    return placement
  }
  const held = state.plates.find(
    (plate) => plate.setup.deviceId === target.deviceId
  )
  return {
    deviceId: target.deviceId,
    bedSetupId: target.bedSetupId,
    anchors: target.anchors
      ? plateAnchors(
          { bedSetupId: target.bedSetupId, anchors: null },
          target.anchors,
          target.bedSetups
        )
      : null,
    fixtures: held ? structuredClone(held.setup.fixtures) : [],
  }
}

/** Selects one device for the whole project as an undoable edit, keeping placed fixtures. */
export function selectProjectProfile(
  workspace: WorkspaceStore,
  fixtures: FixtureLibraryStore,
  profileId: string
): Result<WorkspaceState> {
  const { profiles } = fixtures.state
  if (!Object.hasOwn(profiles, profileId))
    return fail("This device profile is no longer available.")
  const target = projectProfileSnapshot(profileId, profiles[profileId])
  const result = workspace.dispatch({
    type: "plates.useProfile",
    ...target,
    bedSetupId: profiles[profileId].defaultBedSetupId,
    fixtures: [],
  })
  if (result.ok) fixtures.select(profileId)
  return result
}
