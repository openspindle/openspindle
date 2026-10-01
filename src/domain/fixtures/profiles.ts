import { z } from "zod"
import { StoredAnchorSetupSchema } from "../anchors/stored-anchors"
import { machineId } from "@/machine/contract"
import type { ConnectedDevice } from "@/machine/contract"
import { DEFAULT_KIT, kitForDevice, kitOf } from "@/domain/fixtures/catalog"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import { EntityIdSchema, TextSchema } from "@/domain/primitives"
import { FIXTURE_LIMIT, FixtureDefinitionSchema } from "./definitions"
import type { FixtureDefinition } from "./definitions"

/** The profile used when no device is selected. */
export const WORKSPACE_PROFILE = "workspace"

/** The device a profile id stands for; the workspace profile has none. */
export const profileDeviceId = (id: string) =>
  id === WORKSPACE_PROFILE ? null : id

/** The most profiles the fixture library holds. */
export const FIXTURE_PROFILE_LIMIT = 100

/** A device's fixture definitions and anchors, which new plates for it start from. */
export const FixtureProfileSchema = z.object({
  name: TextSchema,
  anchors: StoredAnchorSetupSchema.optional(),
  definitions: z
    .array(FixtureDefinitionSchema)
    .max(FIXTURE_LIMIT)
    .refine(
      (definitions) =>
        new Set(definitions.map((definition) => definition.id)).size ===
        definitions.length,
      "Fixture definition ids repeat."
    ),
  /** The version of the kit its fixtures come from (`FixtureKit`); absent before version 2. */
  bundle: z.int().min(1).optional(),
})
export type FixtureProfile = z.infer<typeof FixtureProfileSchema>

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

/** The fixtures a device's profile defines (the workspace profile's without a device), if any. */
export function deviceDefinitions(
  profiles: FixtureProfiles,
  deviceId: string | null
): readonly FixtureDefinition[] {
  const id = deviceId ?? WORKSPACE_PROFILE
  return Object.hasOwn(profiles, id) ? profiles[id].definitions : []
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
  deviceId: string | null
): FixtureProfile => ({
  name,
  anchors: kit.factoryAnchors(deviceId),
  definitions: kit.definitions(),
  bundle: kit.version,
})

/** A device's first profile: its machine's kit, or no fixtures when OpenSpindle has none. */
export function defaultFixtureProfile(
  device?: ConnectedDevice | null
): FixtureProfile {
  if (!device) return kitProfile(DEFAULT_KIT, "Workspace defaults", null)
  const kit = kitForDevice(device.model)
  if (!kit) return { name: device.name, definitions: [] }
  return kitProfile(kit, device.name, machineId(device))
}

/**
 * A profile made from an earlier version of its kit gains the fixtures added since and the
 * corrections made since, once: a fixture deleted afterwards stays deleted. It catches up as far
 * as it has room for the fixtures added: the versions whose fixtures would take it past
 * `FIXTURE_LIMIT` wait, with their corrections, until it has room for them.
 */
export function withCurrentBundle(profile: FixtureProfile): FixtureProfile {
  const kit = kitOf(profile.definitions)
  const from = profile.bundle ?? 1
  if (!kit || from >= kit.version) return profile
  const held = new Set(profile.definitions.map((definition) => definition.id))
  const addedUpTo = (to: number) =>
    kit.fixtures.filter(
      ({ fixture, addedIn }) =>
        addedIn > from && addedIn <= to && !held.has(fixture.id)
    )
  let to = kit.version
  while (
    to > from &&
    profile.definitions.length + addedUpTo(to).length > FIXTURE_LIMIT
  )
    to -= 1
  if (to === from) return profile
  const definitions = profile.definitions.map((definition) =>
    refreshed(kit, definition, from, to)
  )
  const added = addedUpTo(to).map(({ fixture }) => fixture.definition())
  return { ...profile, definitions: [...definitions, ...added], bundle: to }
}
