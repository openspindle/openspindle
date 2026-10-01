import { Store } from "@tanstack/react-store"
import { History, sameData } from "@/app/workspace/history"
import type { PlatePlacement } from "@/app/workspace/import-program"
import {
  WORKSPACE_PROFILE,
  defaultFixtureProfile,
  profileDeviceId,
  withCurrentBundle,
} from "@/domain/fixtures/profiles"
import type {
  FixtureProfile,
  FixtureProfiles,
} from "@/domain/fixtures/profiles"
import { defaultFixtureInstances } from "@/domain/fixtures/definitions"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import {
  anchorsFromDevice,
  isStoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"
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

/** Where new plates are set up: the selected profile's fixtures, its device and anchors. */
export function profilePlacement(library: FixtureLibrary): PlatePlacement {
  const profile = selectedProfile(library)
  return {
    fixtures: defaultFixtureInstances(profile.definitions),
    deviceId: profileDeviceId(library.selectedId),
    anchors: profile.anchors ? structuredClone(profile.anchors) : null,
  }
}

/**
 * The anchors that one state of the library has and the other had not, with the device they
 * belong to: plates set up for that device follow them when an undo or a redo restores them.
 */
export function changedAnchors(
  before: FixtureLibrary,
  after: FixtureLibrary
): { deviceId: string | null; anchors: StoredAnchorSetup }[] {
  return Object.entries(after.profiles).flatMap(([id, { anchors }]) => {
    const previous = Object.hasOwn(before.profiles, id)
      ? before.profiles[id].anchors
      : undefined
    return anchors && anchors !== previous
      ? [{ deviceId: profileDeviceId(id), anchors }]
      : []
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
   * Records anchors read from a device's configuration. Returns the stored setup when it
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
      if (
        profile.anchors?.source === "firmware-config" &&
        profile.anchors.fetchedAt === configuration.fetchedAt
      )
        return library
      // The bed stays where the profile aligned it; a profile saved without anchors has the
      // bed where its machine's kit places it.
      const anchors = anchorsFromDevice(
        configuration,
        id,
        profile.anchors?.bedOffset
      )
      if (!isStoredAnchorSetup(anchors)) return library
      return {
        ...library,
        profiles: { ...library.profiles, [id]: { ...profile, anchors } },
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

  setDefinitions(definitions: FixtureDefinition[]) {
    const { selectedId } = this.state
    const key = definitionsKey(
      selectedProfile(this.state).definitions,
      definitions
    )
    this.edit(
      (library) =>
        Object.hasOwn(library.profiles, library.selectedId)
          ? this.withSelected(library, { definitions })
          : library,
      key === null ? null : `definitions:${selectedId}:${key}`
    )
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
