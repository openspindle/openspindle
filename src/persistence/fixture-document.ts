import { z } from "zod"
import {
  DEFAULT_BED_SETUP,
  FIXTURE_PROFILE_LIMIT,
  FixtureProfilesSchema,
  WORKSPACE_PROFILE,
} from "@/domain/fixtures/profiles"
import type { FixtureProfiles } from "@/domain/fixtures/profiles"
import { EntityIdSchema, plural } from "@/domain/primitives"
import { describePath, readOptimistically } from "@/formats/optimistic-read"
import type { ValuePath } from "@/formats/optimistic-read"
import type { StoragePort } from "@/platform/host"
import { upgradeProfileBedFrame } from "@/formats/upgrade/bed-frame"
import { Repository } from "./repository"
import type { Decoded } from "./repository"

/**
 * The fixture library: the device profiles and the one the Device tab shows. Saving checks it
 * with the schema each profile is read with, so it never keeps one the next load would drop.
 */
export const FixtureLibrarySchema = z.object({
  selectedId: EntityIdSchema,
  profiles: FixtureProfilesSchema,
})
export type FixtureLibrary = z.infer<typeof FixtureLibrarySchema>

/** How many of a profile's left-out fields a message names before it just counts the rest. */
const NAMED_FIELDS = 5

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

/** Fields of a profile, by their paths in it, as a person reads them. */
function fieldList(profile: unknown, paths: readonly ValuePath[]): string {
  const named = paths
    .slice(0, NAMED_FIELDS)
    .map((path) => describePath(profile, path) || "the profile")
  const more = paths.length - named.length
  return more > 0 ? `${named.join(", ")}, and ${more} more` : named.join(", ")
}

/** Why a profile could not be read: the schema's first reason, and where. */
function dropReason(profile: unknown, error: z.ZodError): string {
  const issue = error.issues.at(0)
  if (!issue) return ""
  // The profile was read as a library of its own: its paths start with its id.
  const where = fieldList(profile, [issue.path.slice(1)])
  return `: ${issue.message.replace(/\.$/, "")} (${where})`
}

/**
 * Profiles are read one by one, each by the library's schema as a library of its own: one that
 * cannot be read is dropped, and fields one has that the schema does not keep are left out.
 * Both are named, with the reason.
 */
function decodeFixtures(data: unknown): Decoded<FixtureLibrary> {
  if (!record(data) || !record(data.profiles))
    throw new Error("it is not a fixture library")
  const dropped: string[] = []
  const profiles: FixtureProfiles = {}
  const entries = Object.entries(data.profiles)
  if (entries.length > FIXTURE_PROFILE_LIMIT)
    dropped.push(
      `${entries.length - FIXTURE_PROFILE_LIMIT} fixture profiles beyond the limit were dropped.`
    )
  for (const [id, value] of entries.slice(0, FIXTURE_PROFILE_LIMIT)) {
    const read = readOptimistically(FixtureProfilesSchema, { [id]: value })
    // A record never keeps a `__proto__` key.
    if (!read.success || !Object.hasOwn(read.data, id)) {
      const reason = read.success ? "" : dropReason(value, read.error)
      dropped.push(
        `Fixture profile "${id}" could not be read and was dropped${reason}.`
      )
      continue
    }
    profiles[id] = read.data[id]
    const leftOut = read.leftOut.map((path) => path.slice(1))
    const verb = leftOut.length === 1 ? "was" : "were"
    if (leftOut.length)
      dropped.push(
        `Fixture profile "${id}": ${plural(leftOut.length, "field")} ${verb} left out, which this version of OpenSpindle does not use: ${fieldList(value, leftOut)}.`
      )
  }
  const selectedId =
    typeof data.selectedId === "string" &&
    Object.hasOwn(profiles, data.selectedId)
      ? data.selectedId
      : WORKSPACE_PROFILE
  return { value: { selectedId, profiles }, dropped }
}

/** A profile of version 2, whose fixture definitions become its first bed setup's. */
function withBedSetups(profile: unknown): unknown {
  if (!record(profile) || !Object.hasOwn(profile, "definitions")) return profile
  const { definitions, ...rest } = profile
  return {
    ...rest,
    bedSetups: [
      { id: DEFAULT_BED_SETUP, name: "Default", definitions, anchors: [] },
    ],
    defaultBedSetupId: DEFAULT_BED_SETUP,
  }
}

/**
 * A fixture library of version 2, whose positions had the work area's front-left corner at the
 * origin: each profile in bed coordinates from Anchor 1 (`upgradeProfileBedFrame`), its fixture
 * definitions its first bed setup's.
 */
function upgradeFixtures(data: unknown): unknown {
  if (!record(data) || !record(data.profiles)) return data
  return {
    ...data,
    profiles: Object.fromEntries(
      Object.entries(data.profiles).map(([id, profile]) => [
        id,
        withBedSetups(upgradeProfileBedFrame(profile)),
      ])
    ),
  }
}

/**
 * Version 3: bed coordinates are from Anchor 1, with Z 0 on the MDF bed's top, and a profile's
 * fixtures are in bed setups.
 */
export function fixtureRepository(storage: StoragePort) {
  return new Repository<FixtureLibrary>(storage, {
    key: "fixtures",
    title: "The fixture library",
    version: 3,
    upgrade: { oldest: 2, from: upgradeFixtures },
    decode: decodeFixtures,
    encode: (value) => value,
    schema: FixtureLibrarySchema,
  })
}
