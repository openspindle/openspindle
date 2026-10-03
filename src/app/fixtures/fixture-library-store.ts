import { Store } from "@tanstack/react-store"
import { History, sameData } from "@/app/workspace/history"
import type { PlatePlacement } from "@/app/workspace/import-program"
import {
  BED_SETUP_LIMIT,
  WORKSPACE_PROFILE,
  bedFixture,
  bedSetupAnchors,
  bedSetupDefinitions,
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
import {
  FIXTURE_LIMIT,
  defaultFixtureInstances,
  isBedKind,
  withDefinitionOrigin,
} from "@/domain/fixtures/definitions"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/primitives"
import { FIXTURE_KITS } from "@/domain/fixtures/catalog"
import {
  FIXTURE_CATALOG_LIMIT,
  defaultFixtureCompatibility,
} from "@/domain/fixtures/compatibility"
import { internFixtureDefinitions } from "@/domain/fixtures/fixture-catalog"
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

export const createFixtureLibrary = (): FixtureLibrary => {
  const definitions = FIXTURE_KITS.flatMap((kit) => kit.definitions()).map(
    (definition) => ({
      ...definition,
      compatibility: defaultFixtureCompatibility(definition),
    })
  )
  return {
    selectedId: WORKSPACE_PROFILE,
    definitions,
    bundles: Object.fromEntries(
      FIXTURE_KITS.map((kit) => [kit.id, kit.version])
    ),
    profiles: { [WORKSPACE_PROFILE]: defaultFixtureProfile(null, definitions) },
  }
}

export function selectedProfile(library: FixtureLibrary): FixtureProfile {
  return Object.hasOwn(library.profiles, library.selectedId)
    ? library.profiles[library.selectedId]
    : defaultFixtureProfile(null, library.definitions)
}

/**
 * Where plates are set up on a profile's bed setup (its default one unless `bedSetupId` names
 * another): its fixtures, the profile's device, and the device's anchors with the bed setup's.
 */
export function bedSetupPlacement(
  profileId: string,
  profile: FixtureProfile,
  bedSetupId?: string | null,
  definitions: readonly FixtureDefinition[] = []
): PlatePlacement {
  const setup = bedSetupOf(profile, bedSetupId)
  return {
    fixtures: defaultFixtureInstances(
      bedSetupDefinitions(definitions, setup, profileDeviceId(profileId))
    ),
    deviceId: profileDeviceId(profileId),
    anchors: bedSetupAnchors(profile, setup),
    bedSetupId: setup.id,
  }
}

/** Where new plates are set up: the selected profile's default bed setup. */
export const profilePlacement = (library: FixtureLibrary): PlatePlacement =>
  bedSetupPlacement(
    library.selectedId,
    selectedProfile(library),
    null,
    library.definitions
  )

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
  sameData(left.profiles, right.profiles) &&
  sameData(left.definitions, right.definitions) &&
  sameData(left.bundles, right.bundles)

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
    // Bundled fixtures update globally once; profiles keep only their bed placements.
    const current = withCurrentBundle({
      ...value,
      profiles: {
        [WORKSPACE_PROFILE]: defaultFixtureProfile(null, value.definitions),
        ...value.profiles,
      },
    })
    // The stored library replaces the one the steps edited.
    this.history.clear()
    this.store.setState(() => current)
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
        ...library,
        selectedId: id,
        profiles: Object.hasOwn(library.profiles, id)
          ? library.profiles
          : {
              ...library.profiles,
              [id]: defaultFixtureProfile(device, library.definitions),
            },
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
        : defaultFixtureProfile(device, library.definitions)
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

  /** Adds one global fixture. Larger migrated catalogs keep their entries but cannot grow. */
  addDefinition(definition: FixtureDefinition) {
    this.edit((library) => {
      if (
        library.definitions.length >= FIXTURE_CATALOG_LIMIT ||
        library.definitions.some((item) => item.id === definition.id)
      )
        return library
      return {
        ...library,
        definitions: [
          ...library.definitions,
          {
            ...definition,
            compatibility:
              definition.compatibility ??
              defaultFixtureCompatibility(definition),
          },
        ],
      }
    }, null)
  }

  /** Edits one global definition; bed placement overrides stay on their beds. */
  setDefinition(definition: FixtureDefinition, origin?: Point3) {
    const previous = this.state.definitions.find(
      (item) => item.id === definition.id
    )
    if (!previous) return
    const changed = origin
      ? {
          ...definition,
          defaultPosition: withDefinitionOrigin(previous, origin)
            .defaultPosition,
        }
      : definition
    const key = definitionsKey([previous], [changed])
    this.edit(
      (library) => {
        const profiles = origin
          ? Object.fromEntries(
              Object.entries(library.profiles).map(([id, profile]) => [
                id,
                {
                  ...profile,
                  bedSetups: profile.bedSetups.map((setup) => ({
                    ...setup,
                    fixtures: setup.fixtures.map((placement) =>
                      placement.definitionId === definition.id
                        ? {
                            ...placement,
                            position: withDefinitionOrigin(
                              {
                                ...previous,
                                defaultPosition: placement.position,
                                defaultRotation: placement.rotation,
                              },
                              origin
                            ).defaultPosition,
                          }
                        : placement
                    ),
                  })),
                },
              ])
            )
          : library.profiles
        return {
          ...library,
          profiles,
          definitions: library.definitions.map((item) =>
            item.id === definition.id ? changed : item
          ),
        }
      },
      key === null ? null : `definition:${key}`
    )
  }

  /** Removes a global definition and its bed references; placed plate snapshots stay. */
  removeDefinition(id: string) {
    this.edit((library) => {
      if (!library.definitions.some((item) => item.id === id)) return library
      return {
        ...library,
        definitions: library.definitions.filter((item) => item.id !== id),
        profiles: Object.fromEntries(
          Object.entries(library.profiles).map(([profileId, profile]) => [
            profileId,
            {
              ...profile,
              bedSetups: profile.bedSetups.map((setup) => ({
                ...setup,
                fixtures: setup.fixtures.filter(
                  (item) => item.definitionId !== id
                ),
              })),
            },
          ])
        ),
      }
    }, null)
  }

  /** Changes only this bed's use and placement of a global fixture. */
  setBedFixture(
    bedSetupId: string,
    definitionId: string,
    patch: Partial<
      Pick<
        FixtureDefinition,
        "defaultEnabled" | "defaultPosition" | "defaultRotation"
      >
    >,
    profileId: string = this.state.selectedId
  ) {
    this.edit(
      (library) => {
        if (!Object.hasOwn(library.profiles, profileId)) return library
        const setup = library.profiles[profileId].bedSetups.find(
          (item) => item.id === bedSetupId
        )
        const definition = library.definitions.find(
          (item) => item.id === definitionId
        )
        if (!setup || !definition) return library
        const held = setup.fixtures.find(
          (item) => item.definitionId === definitionId
        )
        if (!held && setup.fixtures.length >= FIXTURE_CATALOG_LIMIT)
          return library
        const before = held ?? { ...bedFixture(definition), enabled: false }
        const changed = {
          ...before,
          enabled: patch.defaultEnabled ?? before.enabled,
          position: patch.defaultPosition ?? before.position,
          rotation: patch.defaultRotation ?? before.rotation,
        }
        const byId = new Map(library.definitions.map((item) => [item.id, item]))
        const placed = held
          ? setup.fixtures.map((item) =>
              item.definitionId === definitionId ? changed : item
            )
          : [...setup.fixtures, changed]
        const fixtures = placed.map((item) => {
          const other = byId.get(item.definitionId)
          return item.definitionId !== definitionId &&
            changed.enabled &&
            isBedKind(definition.kind) &&
            other &&
            isBedKind(other.kind)
            ? { ...item, enabled: false }
            : item
        })
        if (fixtures.filter((item) => item.enabled).length > FIXTURE_LIMIT)
          return library
        return this.withBedSetup(library, bedSetupId, { fixtures }, profileId)
      },
      `bed-fixture:${profileId}:${bedSetupId}:${definitionId}:${Object.keys(patch).sort().join(",")}`
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
      fixtures: structuredClone(source.fixtures),
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
  keepBedSetup(
    profileId: string,
    setup: BedSetup,
    snapshots: readonly FixtureDefinition[] = []
  ) {
    this.edit((library) => {
      if (!Object.hasOwn(library.profiles, profileId)) return library
      const profile = library.profiles[profileId]
      if (
        profile.bedSetups.length >= BED_SETUP_LIMIT ||
        profile.bedSetups.some((item) => item.id === setup.id)
      )
        return library
      const firstSnapshots = snapshots.filter(
        (item, index) =>
          snapshots.findIndex((other) => other.id === item.id) === index
      )
      const imported = internFixtureDefinitions(
        library.definitions,
        firstSnapshots
      )
      const ids = new Set(
        imported.definitions.map((definition) => definition.id)
      )
      const kept = {
        ...setup,
        fixtures: setup.fixtures
          .filter(
            (item, index) =>
              setup.fixtures.findIndex(
                (other) => other.definitionId === item.definitionId
              ) === index
          )
          .map((item) => ({
            ...item,
            definitionId:
              imported.ids.get(item.definitionId) ?? item.definitionId,
          })),
      }
      if (kept.fixtures.some((item) => !ids.has(item.definitionId)))
        return library
      return {
        ...library,
        definitions: imported.definitions,
        profiles: {
          ...library.profiles,
          [profileId]: { ...profile, bedSetups: [...profile.bedSetups, kept] },
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
    patch: Partial<BedSetup>,
    profileId: string = library.selectedId
  ): FixtureLibrary {
    if (!Object.hasOwn(library.profiles, profileId)) return library
    const { bedSetups } = library.profiles[profileId]
    if (!bedSetups.some((setup) => setup.id === bedSetupId)) return library
    return this.withProfile(library, profileId, {
      bedSetups: bedSetups.map((setup) =>
        setup.id === bedSetupId ? { ...setup, ...patch } : setup
      ),
    })
  }

  private withSelected(
    library: FixtureLibrary,
    patch: Partial<FixtureProfile>
  ): FixtureLibrary {
    return this.withProfile(library, library.selectedId, patch)
  }

  private withProfile(
    library: FixtureLibrary,
    profileId: string,
    patch: Partial<FixtureProfile>
  ): FixtureLibrary {
    const profiles: FixtureProfiles = {
      ...library.profiles,
      [profileId]: { ...library.profiles[profileId], ...patch },
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
