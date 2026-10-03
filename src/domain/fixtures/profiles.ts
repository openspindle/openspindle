import { z } from "zod"
import {
  BED_SETUP_ANCHOR_LIMIT,
  BedSetupAnchorSchema,
  StoredAnchorSetupSchema,
  withBedSetupAnchors,
} from "../anchors/stored-anchors"
import type { StoredAnchorSetup } from "../anchors/stored-anchors"
import type { BedSetupAnchors } from "../plate/bed-setup"
import { AddedAnchorSchema, machineId } from "@/machine/contract"
import type { ConnectedDevice } from "@/machine/contract"
import {
  DEFAULT_KIT,
  FIXTURE_KITS,
  kitForDevice,
  kitForDeviceId,
  kitOf,
} from "@/domain/fixtures/catalog"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import { EntityIdSchema, Point3Schema, TextSchema } from "@/domain/primitives"
import { FIXTURE_LIMIT } from "./definitions"
import type { FixtureDefinition } from "./definitions"
import {
  defaultFixtureCompatibility,
  fixtureCompatible,
  FIXTURE_CATALOG_LIMIT,
} from "./compatibility"

/** The profile used when no device is selected. */
export const WORKSPACE_PROFILE = "workspace"

/** The device a profile id stands for; the workspace profile has none. */
export const profileDeviceId = (id: string) =>
  id === WORKSPACE_PROFILE ? null : id

/** The most profiles the fixture library holds. */
export const FIXTURE_PROFILE_LIMIT = 100

/** The most bed setups a device's profile holds. */
export const BED_SETUP_LIMIT = 20

/** The bed setup a profile starts with. */
export const DEFAULT_BED_SETUP = "default"

const uniqueIds = (items: readonly { readonly id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length

/** A global fixture's placement on one bed setup. */
export const BedFixtureSchema = z.object({
  definitionId: EntityIdSchema,
  enabled: z.boolean(),
  position: Point3Schema,
  rotation: Point3Schema,
})
export type BedFixture = z.infer<typeof BedFixtureSchema>

/** A device's bed arrangement: global fixture placements and anchors of its own. */
export const BedSetupSchema = z.object({
  id: EntityIdSchema,
  name: TextSchema,
  fixtures: z
    .array(BedFixtureSchema)
    .max(FIXTURE_CATALOG_LIMIT)
    .refine(
      (items) =>
        new Set(items.map((item) => item.definitionId)).size === items.length,
      "Fixture definition ids repeat."
    )
    .refine(
      (items) => items.filter((item) => item.enabled).length <= FIXTURE_LIMIT,
      `A bed setup enables at most ${FIXTURE_LIMIT} fixtures.`
    ),
  anchors: z
    .array(BedSetupAnchorSchema)
    .max(BED_SETUP_ANCHOR_LIMIT)
    .refine(uniqueIds, "Anchor ids repeat."),
})
export type BedSetup = z.infer<typeof BedSetupSchema>

/**
 * A device's anchors and the ways its bed is set up (`BedSetup`), which new plates for it start
 * from: its default one unless another is chosen.
 */
export const FixtureProfileSchema = z
  .object({
    name: TextSchema,
    anchors: StoredAnchorSetupSchema.optional(),
    bedSetups: z
      .array(BedSetupSchema)
      .min(1)
      .max(BED_SETUP_LIMIT)
      .refine(uniqueIds, "Bed setup ids repeat."),
    defaultBedSetupId: EntityIdSchema,
    /**
     * Whether its device stores its bed setups' anchors in its configuration besides its own,
     * which the app reads and writes (`storedAnchorsMerged`, `anchorsToStore`).
     */
    storeAnchors: z.boolean().optional(),
    /**
     * Its bed setups' anchors as its device stored them when they were last read or written, by
     * the read's time: what the app's edits since are told from. Only while `storeAnchors`.
     */
    storedAnchors: z
      .object({
        fetchedAt: z.number().min(0),
        anchors: z
          .array(AddedAnchorSchema)
          .max(BED_SETUP_LIMIT * BED_SETUP_ANCHOR_LIMIT),
      })
      .optional(),
    /** The version of the kit its fixtures come from (`FixtureKit`); absent before version 2. */
    bundle: z.int().min(1).optional(),
  })
  .superRefine((profile, context) => {
    if (
      !profile.bedSetups.some((setup) => setup.id === profile.defaultBedSetupId)
    )
      context.addIssue({
        code: "custom",
        message: "Its default bed setup is not one of its bed setups.",
        path: ["defaultBedSetupId"],
      })
    if (profile.anchors?.anchors.some((anchor) => anchor.bedSetup))
      context.addIssue({
        code: "custom",
        message: "Its device's anchors hold a bed setup's.",
        path: ["anchors"],
      })
  })
export type FixtureProfile = z.infer<typeof FixtureProfileSchema>

/** A profile's bed setup with an id, else its default one. */
export function bedSetupOf(
  profile: FixtureProfile,
  id?: string | null
): BedSetup {
  return (
    profile.bedSetups.find((setup) => setup.id === id) ??
    profile.bedSetups.find((setup) => setup.id === profile.defaultBedSetupId) ??
    profile.bedSetups[0]
  )
}

/** All compatible catalog fixtures, with this bed setup's defaults where it places them. */
export function bedSetupDefinitions(
  definitions: readonly FixtureDefinition[],
  setup: BedSetup,
  deviceId: string | null
): FixtureDefinition[] {
  const placements = new Map(
    setup.fixtures.map((item) => [item.definitionId, item])
  )
  return definitions
    .filter((definition) => fixtureCompatible(definition, deviceId))
    .map((definition) => {
      const placement = placements.get(definition.id)
      return {
        ...definition,
        defaultEnabled: placement?.enabled ?? false,
        defaultPosition: placement?.position ?? definition.defaultPosition,
        defaultRotation: placement?.rotation ?? definition.defaultRotation,
      }
    })
}

/** The placement a definition supplies when first added to a bed setup. */
export const bedFixture = (definition: FixtureDefinition): BedFixture => ({
  definitionId: definition.id,
  enabled: definition.defaultEnabled,
  position: [...definition.defaultPosition],
  rotation: [...definition.defaultRotation],
})

/**
 * The anchors a plate on one of a profile's bed setups keeps: the device's, then the bed setup's
 * at the first plus their offsets; null without the device's.
 */
export const bedSetupAnchors = (
  profile: FixtureProfile,
  setup: BedSetup
): StoredAnchorSetup | null =>
  profile.anchors
    ? withBedSetupAnchors(structuredClone(profile.anchors), setup.anchors)
    : null

/** A profile's bed setups' anchors by bed setup id, which plates on them follow. */
export const profileBedSetupAnchors = (
  profile: FixtureProfile
): BedSetupAnchors =>
  Object.fromEntries(
    profile.bedSetups.map((setup) => [setup.id, setup.anchors])
  )

/** A bed setup holding the given fixture definitions and no anchors of its own. */
const firstBedSetup = (
  definitions: readonly FixtureDefinition[]
): BedSetup => ({
  id: DEFAULT_BED_SETUP,
  name: "Default",
  fixtures: definitions.map(bedFixture),
  anchors: [],
})

/** Profiles by id, a device's (`machineId`) or the workspace's, each with its device's anchors. */
export const FixtureProfilesSchema = z
  .record(EntityIdSchema, FixtureProfileSchema)
  .superRefine((profiles, context) => {
    const entries = Object.entries(profiles)
    if (entries.length > FIXTURE_PROFILE_LIMIT)
      context.addIssue({
        code: "custom",
        message: `The fixture library holds at most ${FIXTURE_PROFILE_LIMIT} profiles.`,
      })
    for (const [id, { anchors }] of entries)
      if (anchors && anchors.deviceId !== profileDeviceId(id))
        context.addIssue({
          code: "custom",
          message: "Its anchors belong to another device.",
          path: [id, "anchors"],
        })
  })
export type FixtureProfiles = z.infer<typeof FixtureProfilesSchema>

/**
 * A device's bed setup (the workspace profile's without a device; its default bed setup without
 * one), with the name of the profile it is in; null where the library has no profile for it.
 */
export function deviceBedSetup(
  profiles: FixtureProfiles,
  deviceId: string | null,
  bedSetupId?: string | null
): { readonly device: string; readonly bedSetup: BedSetup } | null {
  const id = deviceId ?? WORKSPACE_PROFILE
  if (!Object.hasOwn(profiles, id)) return null
  const profile = profiles[id]
  return { device: profile.name, bedSetup: bedSetupOf(profile, bedSetupId) }
}

/**
 * A held definition of a kit's fixture with what the kit's versions after `from` up to `to`
 * changed in it: the model and default placement of a correction, and the colour of a
 * recolouring. The name and whether it is on new plates stay the user's, and so does a colour
 * the user chose: only one the kit gave it before is replaced.
 */
function refreshed(
  kit: FixtureKit,
  definition: FixtureDefinition,
  from: number,
  to: number
): FixtureDefinition {
  const held = kit.fixtures.find(({ fixture }) => fixture.id === definition.id)
  if (!held) return definition
  const since = (version = 0) => version > from && version <= to
  const current = held.fixture.definition()
  let result = definition
  if (since(held.changedIn))
    result = {
      ...result,
      model: current.model,
      defaultPosition: current.defaultPosition,
      defaultRotation: current.defaultRotation,
    }
  const { recolored } = held
  if (
    recolored &&
    since(recolored.in) &&
    recolored.from.includes(definition.color.toLowerCase())
  )
    result = { ...result, color: current.color }
  return result
}

/** A new profile from a kit, for one of its devices or for the workspace. */
const kitProfile = (
  kit: FixtureKit,
  name: string,
  deviceId: string | null,
  definitions?: readonly FixtureDefinition[]
): FixtureProfile => ({
  name,
  anchors: kit.factoryAnchors(deviceId),
  bedSetups: [
    firstBedSetup(
      kit
        .definitions()
        .filter(
          (definition) =>
            !definitions ||
            definitions.some((item) => item.id === definition.id)
        )
    ),
  ],
  defaultBedSetupId: DEFAULT_BED_SETUP,
  bundle: kit.version,
})

/** A device's first profile: its machine's kit, or no fixtures when OpenSpindle has none. */
export function defaultFixtureProfile(
  device?: ConnectedDevice | null,
  definitions?: readonly FixtureDefinition[]
): FixtureProfile {
  if (!device)
    return kitProfile(DEFAULT_KIT, "Workspace defaults", null, definitions)
  const kit = kitForDevice(device.model)
  if (!kit)
    return {
      name: device.name,
      bedSetups: [firstBedSetup([])],
      defaultBedSetupId: DEFAULT_BED_SETUP,
    }
  return kitProfile(kit, device.name, machineId(device), definitions)
}

/**
 * Bundled catalog definitions catch up once, retaining global deletions. Each older profile
 * gains placements for additions still in the catalog and corrections to its bed placements.
 * A full catalog or bed setup waits at the last kit version it can hold.
 */
export function withCurrentBundle<
  TLibrary extends {
    definitions: FixtureDefinition[]
    profiles: FixtureProfiles
    bundles: Record<string, number>
  },
>(library: TLibrary): TLibrary {
  let definitions = library.definitions
  const bundles = { ...library.bundles }
  for (const kit of FIXTURE_KITS) {
    const from = bundles[kit.id] ?? 0
    if (from >= kit.version) continue
    const additions = (to: number) =>
      kit.fixtures.filter(
        ({ fixture, addedIn }) =>
          addedIn > from &&
          addedIn <= to &&
          !definitions.some((item) => item.id === fixture.id)
      )
    let to = kit.version
    while (
      to > from &&
      additions(to).length >
        Math.max(0, FIXTURE_CATALOG_LIMIT - definitions.length)
    )
      to--
    if (to === from) continue
    definitions = [
      ...definitions.map((definition) => refreshed(kit, definition, from, to)),
      ...additions(to).map(({ fixture }) => {
        const definition = fixture.definition()
        return {
          ...definition,
          compatibility: defaultFixtureCompatibility(definition),
        }
      }),
    ]
    bundles[kit.id] = to
  }
  const byId = new Map(
    definitions.map((definition) => [definition.id, definition])
  )
  const profiles = Object.fromEntries(
    Object.entries(library.profiles).map(([id, profile]) => {
      const held = profile.bedSetups.flatMap((setup) =>
        setup.fixtures.flatMap((item) => byId.get(item.definitionId) ?? [])
      )
      const kit = kitForDeviceId(profileDeviceId(id)) ?? kitOf(held)
      if (!kit) return [id, profile]
      const from = profile.bundle ?? 1
      let to = bundles[kit.id] ?? from
      if (from >= to) return [id, profile]
      const additions = (setup: BedSetup, version: number) =>
        kit.fixtures
          .filter(
            ({ fixture, addedIn }) =>
              addedIn > from &&
              addedIn <= version &&
              byId.has(fixture.id) &&
              !setup.fixtures.some((item) => item.definitionId === fixture.id)
          )
          .map(({ fixture }) => bedFixture(fixture.definition()))
      while (
        to > from &&
        profile.bedSetups.some((setup) => {
          const added = additions(setup, to)
          return (
            setup.fixtures.length + added.length > FIXTURE_CATALOG_LIMIT ||
            [...setup.fixtures, ...added].filter((item) => item.enabled)
              .length > FIXTURE_LIMIT
          )
        })
      )
        to--
      if (to === from) return [id, profile]
      return [
        id,
        {
          ...profile,
          bundle: to,
          bedSetups: profile.bedSetups.map((setup) => ({
            ...setup,
            fixtures: [
              ...setup.fixtures.map((placement) => {
                const entry = kit.fixtures.find(
                  ({ fixture }) => fixture.id === placement.definitionId
                )
                if (
                  !entry?.changedIn ||
                  entry.changedIn <= from ||
                  entry.changedIn > to
                )
                  return placement
                const current = entry.fixture.definition()
                return {
                  ...placement,
                  position: current.defaultPosition,
                  rotation: current.defaultRotation,
                }
              }),
              ...additions(setup, to),
            ],
          })),
        },
      ]
    })
  )
  return { ...library, definitions, profiles, bundles }
}
