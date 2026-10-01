import { Store } from "@tanstack/react-store"
import { History, sameData } from "@/app/workspace/history"
import type { PlatePlacement } from "@/app/workspace/import-program"
import {
  BED_SETUP_LIMIT,
  WORKSPACE_PROFILE,
  bedSetupAnchors,
  bedSetupOf,
  defaultFixtureProfile,
  profileBedSetupAnchors,
  profileDeviceId,
  withCurrentBundle,
} from "@/domain/fixtures/profiles"
import type {
  BedSetup,
  FixtureProfile,
  FixtureProfiles,
} from "@/domain/fixtures/profiles"
import type { BedSetupAnchors } from "@/domain/plate/bed-setup"
import { defaultFixtureInstances } from "@/domain/fixtures/definitions"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import { storedAnchorsMerged } from "@/domain/fixtures/stored-anchors"
import {
  anchorsFromDevice,
  deviceAnchorsOf,
  isStoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import type {
  BedSetupAnchor,
  StoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import { machineId } from "@/machine/contract"
import type { AnchorConfiguration, ConnectedDevice } from "@/machine/contract"
import type { FixtureLibrary } from "@/persistence/fixture-document"
import type { DocumentTarget } from "@/persistence/bind-document"

export const createFixtureLibrary = (): FixtureLibrary => ({
  selectedId: WORKSPACE_PROFILE,
  profiles: { [WORKSPACE_PROFILE]: defaultFixtureProfile() },
})

export function selectedProfile(library: FixtureLibrary): FixtureProfile {
  return Object.hasOwn(library.profiles, library.selectedId)
    ? library.profiles[library.selectedId]
    : defaultFixtureProfile()
}

/**
 * Where plates are set up on a profile's bed setup (its default one unless `bedSetupId` names
 * another): its fixtures, the profile's device, and the device's anchors with the bed setup's.
 */
export function bedSetupPlacement(
  profileId: string,
  profile: FixtureProfile,
  bedSetupId?: string | null
): PlatePlacement {
  const setup = bedSetupOf(profile, bedSetupId)
  return {
    fixtures: defaultFixtureInstances(setup.definitions),
    deviceId: profileDeviceId(profileId),
    anchors: bedSetupAnchors(profile, setup),
    bedSetupId: setup.id,
  }
}

/** Where new plates are set up: the selected profile's default bed setup. */
export const profilePlacement = (library: FixtureLibrary): PlatePlacement =>
  bedSetupPlacement(library.selectedId, selectedProfile(library))

/** A device's anchors and its bed setups' anchors, which plates set up for it follow. */
export type ProfileAnchors = {
  readonly deviceId: string | null
  readonly anchors: StoredAnchorSetup
  readonly bedSetups: BedSetupAnchors
}

/** A profile's anchors as plates follow them; null without the device's. */
export function profileAnchors(
  profileId: string,
  profile: FixtureProfile
): ProfileAnchors | null {
  return profile.anchors
    ? {
        deviceId: profileDeviceId(profileId),
        anchors: profile.anchors,
        bedSetups: profileBedSetupAnchors(profile),
      }
    : null
}

/**
 * The anchors that one state of the library has and the other had not, a device's or its bed
 * setups', with the device they belong to: plates set up for that device follow them when an
 * undo or a redo restores them.
 */
export function changedAnchors(
  before: FixtureLibrary,
  after: FixtureLibrary
): ProfileAnchors[] {
  return Object.entries(after.profiles).flatMap(([id, profile]) => {
    const previous = Object.hasOwn(before.profiles, id)
      ? before.profiles[id]
      : undefined
    const changed =
      profile.anchors !== previous?.anchors ||
      !sameData(
        profileBedSetupAnchors(profile),
        previous && profileBedSetupAnchors(previous)
      )
    const anchors = profileAnchors(id, profile)
    return changed && anchors ? [anchors] : []
  })
}

/** Whether two states of the library hold the same profiles, whichever is selected. */
const sameProfiles = (left: FixtureLibrary, right: FixtureLibrary) =>
  sameData(left.profiles, right.profiles)

/**
 * What an edit of a profile's definitions changes, so that quick edits of one field (typing a
 * name) merge into one step: each changed definition and its fields. Null when definitions are
 * added, removed or reordered.
 */
function definitionsKey(
  before: readonly FixtureDefinition[],
  after: readonly FixtureDefinition[]
): string | null {
  if (before.length !== after.length) return null
  const changed: string[] = []
  for (const [index, definition] of after.entries()) {
    const previous = before[index]
    if (previous === definition) continue
    if (previous.id !== definition.id) return null
    const fields = new Set([
      ...Object.keys(previous),
      ...Object.keys(definition),
    ])
    const edited = [...fields].filter(
      (field) =>
        !sameData(
          (previous as Record<string, unknown>)[field],
          (definition as Record<string, unknown>)[field]
        )
    )
    changed.push(`${definition.id}:${edited.sort().join(",")}`)
  }
  return changed.join("|")
}

/**
 * Fixture profiles per device: fixture definitions and the anchors plates are placed against.
 * Edits of definitions and the bed offset are recorded for Undo and Redo on the Device tab; what a
 * device reports and the selected profile are not edits, and stay when steps are undone.
 */
export class FixtureLibraryStore implements DocumentTarget<FixtureLibrary> {
  readonly store = new Store<FixtureLibrary>(createFixtureLibrary())
  readonly history = new History<FixtureLibrary>({ same: sameProfiles })

  get state(): FixtureLibrary {
    return this.store.state
  }

  readonly hydrate = (value: FixtureLibrary) => {
    // Profiles made from an earlier version of their kit catch up (saved with the next change).
    const profiles = Object.entries({
      ...createFixtureLibrary().profiles,
      ...value.profiles,
    }).map(([id, profile]) => [id, withCurrentBundle(profile)] as const)
    // The stored library replaces the one the steps edited.
    this.history.clear()
    this.store.setState(() => ({
      ...value,
      profiles: Object.fromEntries(profiles),
    }))
  }

  readonly subscribe = (listener: (value: FixtureLibrary) => void) => {
    const subscription = this.store.subscribe(listener)
    return () => subscription.unsubscribe()
  }

  /** Undoes the latest edit; false when there is none. */
  undo(): boolean {
    return this.restore(this.history.undo())
  }

  /** Redoes the edit undone last; false when there is none. */
  redo(): boolean {
    return this.restore(this.history.redo())
  }

  select(id: string) {
    this.change((library) =>
      Object.hasOwn(library.profiles, id)
        ? { ...library, selectedId: id }
        : library
    )
  }

  /** A connected device gets its own profile (created from defaults once) and is selected. */
  adoptDevice(device: ConnectedDevice) {
    const id = machineId(device)
    this.change((library) => {
      if (library.selectedId === id && Object.hasOwn(library.profiles, id))
        return library
      return {
        selectedId: id,
        profiles: Object.hasOwn(library.profiles, id)
          ? library.profiles
          : { ...library.profiles, [id]: defaultFixtureProfile(device) },
      }
    })
  }

  /**
   * Records anchors read from a device's configuration, and the bed setups' anchors it stores
   * when its profile has it store them (`storedAnchorsMerged`). Returns the stored setup when it
   * changed, so plates bound to the device can follow; null when nothing changed.
   */
  recordDeviceAnchors(
    device: ConnectedDevice,
    configuration: AnchorConfiguration
  ): StoredAnchorSetup | null {
    const id = machineId(device)
    const before = this.state
    // Read from the library it applies to, so replayed after an undo it keeps that bed offset.
    this.change((library) => {
      const profile = Object.hasOwn(library.profiles, id)
        ? library.profiles[id]
        : defaultFixtureProfile(device)
      const read =
        profile.anchors?.source === "firmware-config" &&
        profile.anchors.fetchedAt === configuration.fetchedAt
      // The bed stays where the profile aligned it; a profile saved without anchors has the
      // bed where its machine's kit places it.
      const anchors = read
        ? profile.anchors
        : anchorsFromDevice(configuration, id, profile.anchors?.bedOffset)
      if (!anchors || !isStoredAnchorSetup(anchors)) return library
      const recorded = storedAnchorsMerged(
        read ? profile : { ...profile, anchors },
        configuration,
        deviceAnchorsOf(anchors).length
      )
      if (recorded === profile) return library
      return {
        ...library,
        profiles: { ...library.profiles, [id]: recorded },
      }
    })
    return this.state === before
      ? null
      : (this.state.profiles[id].anchors ?? null)
  }

  /** Replaces the selected profile's anchors (they must belong to its device). */
  setAnchors(anchors: StoredAnchorSetup) {
    this.edit((library) => {
      if (
        !isStoredAnchorSetup(anchors) ||
        anchors.deviceId !== profileDeviceId(library.selectedId) ||
        !Object.hasOwn(library.profiles, library.selectedId)
      )
        return library
      return this.withSelected(library, { anchors })
    }, `anchors:${this.state.selectedId}`)
  }

  /**
   * Whether the selected profile's device stores its bed setups' anchors; what it stored is
   * forgotten when it no longer does, and read again when it does.
   */
  setStoreAnchors(storeAnchors: boolean) {
    this.edit((library) => {
      if (!Object.hasOwn(library.profiles, library.selectedId)) return library
      const { storedAnchors: _, ...profile } = selectedProfile(library)
      return this.withSelected(
        {
          ...library,
          profiles: { ...library.profiles, [library.selectedId]: profile },
        },
        { storeAnchors }
      )
    }, null)
  }

  /** Replaces the fixture definitions of one of the selected profile's bed setups. */
  setDefinitions(bedSetupId: string, definitions: FixtureDefinition[]) {
    const { selectedId } = this.state
    const setup = selectedProfile(this.state).bedSetups.find(
      (item) => item.id === bedSetupId
    )
    if (!setup) return
    const key = definitionsKey(setup.definitions, definitions)
    this.edit(
      (library) => this.withBedSetup(library, bedSetupId, { definitions }),
      key === null ? null : `definitions:${selectedId}:${bedSetupId}:${key}`
    )
  }

  /** Replaces the anchors one of the selected profile's bed setups keeps. */
  setBedSetupAnchors(bedSetupId: string, anchors: BedSetupAnchor[]) {
    this.edit(
      (library) => this.withBedSetup(library, bedSetupId, { anchors }),
      `bed-setup-anchors:${this.state.selectedId}:${bedSetupId}`
    )
  }

  /**
   * Adds a bed setup to the selected profile, a copy of `from` (its fixtures and anchors, with
   * anchor ids of its own) or with its default bed setup's fixtures; returns its id, or null when
   * the profile holds as many as it can.
   */
  addBedSetup(name: string, from?: string): string | null {
    const profile = selectedProfile(this.state)
    if (profile.bedSetups.length >= BED_SETUP_LIMIT) return null
    const source = bedSetupOf(profile, from)
    const setup: BedSetup = {
      id: crypto.randomUUID(),
      name,
      definitions: structuredClone(source.definitions),
      anchors: from
        ? source.anchors.map((anchor) => ({
            ...anchor,
            id: crypto.randomUUID(),
          }))
        : [],
    }
    this.edit(
      (library) =>
        Object.hasOwn(library.profiles, library.selectedId)
          ? this.withSelected(library, {
              bedSetups: [...selectedProfile(library).bedSetups, setup],
            })
          : library,
      null
    )
    return setup.id
  }

  renameBedSetup(bedSetupId: string, name: string) {
    this.edit(
      (library) => this.withBedSetup(library, bedSetupId, { name }),
      `bed-setup-name:${this.state.selectedId}:${bedSetupId}`
    )
  }

  /** Removes one of the selected profile's bed setups; its last one stays. */
  removeBedSetup(bedSetupId: string) {
    this.edit((library) => {
      if (!Object.hasOwn(library.profiles, library.selectedId)) return library
      const profile = selectedProfile(library)
      const bedSetups = profile.bedSetups.filter(
        (setup) => setup.id !== bedSetupId
      )
      if (!bedSetups.length || bedSetups.length === profile.bedSetups.length)
        return library
      const defaultBedSetupId =
        profile.defaultBedSetupId === bedSetupId
          ? bedSetups[0].id
          : profile.defaultBedSetupId
      return this.withSelected(library, { bedSetups, defaultBedSetupId })
    }, null)
  }

  /**
   * Moves the anchors of every bed setup of the selected profile by `delta` from its device's
   * first anchor: where that anchor moved by the opposite, they stay where they were.
   */
  moveBedSetupAnchors([dx, dy]: readonly [number, number]) {
    this.edit((library) => {
      if (!Object.hasOwn(library.profiles, library.selectedId)) return library
      const { bedSetups } = library.profiles[library.selectedId]
      return this.withSelected(library, {
        bedSetups: bedSetups.map((setup) => ({
          ...setup,
          anchors: setup.anchors.map((anchor) => ({
            ...anchor,
            offset: [
              Number((anchor.offset[0] + dx).toFixed(6)) + 0,
              Number((anchor.offset[1] + dy).toFixed(6)) + 0,
            ],
          })),
        })),
      })
    }, null)
  }

  /**
   * Keeps a bed setup in a device's profile, such as one a plate set up on another computer
   * names, unless the profile has one of its id or holds as many as it can.
   */
  keepBedSetup(profileId: string, setup: BedSetup) {
    this.edit((library) => {
      if (!Object.hasOwn(library.profiles, profileId)) return library
      const profile = library.profiles[profileId]
      if (
        profile.bedSetups.length >= BED_SETUP_LIMIT ||
        profile.bedSetups.some((item) => item.id === setup.id)
      )
        return library
      return {
        ...library,
        profiles: {
          ...library.profiles,
          [profileId]: { ...profile, bedSetups: [...profile.bedSetups, setup] },
        },
      }
    }, null)
  }

  /** Makes one of the selected profile's bed setups the one new plates start on. */
  setDefaultBedSetup(bedSetupId: string) {
    this.edit((library) => {
      if (!Object.hasOwn(library.profiles, library.selectedId)) return library
      const profile = selectedProfile(library)
      if (
        profile.defaultBedSetupId === bedSetupId ||
        !profile.bedSetups.some((setup) => setup.id === bedSetupId)
      )
        return library
      return this.withSelected(library, { defaultBedSetupId: bedSetupId })
    }, null)
  }

  private withBedSetup(
    library: FixtureLibrary,
    bedSetupId: string,
    patch: Partial<BedSetup>
  ): FixtureLibrary {
    if (!Object.hasOwn(library.profiles, library.selectedId)) return library
    const { bedSetups } = library.profiles[library.selectedId]
    if (!bedSetups.some((setup) => setup.id === bedSetupId)) return library
    return this.withSelected(library, {
      bedSetups: bedSetups.map((setup) =>
        setup.id === bedSetupId ? { ...setup, ...patch } : setup
      ),
    })
  }

  private withSelected(
    library: FixtureLibrary,
    patch: Partial<FixtureProfile>
  ): FixtureLibrary {
    const profiles: FixtureProfiles = {
      ...library.profiles,
      [library.selectedId]: {
        ...library.profiles[library.selectedId],
        ...patch,
      },
    }
    return { ...library, profiles }
  }

  /** An edit, which Undo undoes; edits of the same `key` in quick succession are one step. */
  private edit(
    updater: (library: FixtureLibrary) => FixtureLibrary,
    key: string | null
  ) {
    const before = this.state
    const after = updater(before)
    if (after !== before && this.history.record(before, after, key))
      this.store.setState(() => after)
  }

  /** A change that is not an edit, which undo and redo replay with `updater`. */
  private change(updater: (library: FixtureLibrary) => FixtureLibrary) {
    const before = this.state
    const after = updater(before)
    if (after === before) return
    this.history.note(before, after, updater)
    this.store.setState(() => after)
  }

  /** Restores a state of the library; the selected profile stays while it has one. */
  private restore(library: FixtureLibrary | null): boolean {
    if (!library) return false
    const { selectedId } = this.state
    const next =
      selectedId !== library.selectedId &&
      Object.hasOwn(library.profiles, selectedId)
        ? { ...library, selectedId }
        : library
    this.store.setState(() => next)
    return true
  }
}
