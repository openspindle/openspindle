import type { AddedAnchor, AnchorConfiguration } from "@/machine/contract"
import { BED_SETUP_ANCHOR_LIMIT } from "../anchors/stored-anchors"
import type { AnchorXY, BedSetupAnchor } from "../anchors/stored-anchors"
import { toMicrometre } from "../primitives"
import { bedSetupOf } from "./profiles"
import type { FixtureProfile } from "./profiles"

/** An id a device's configuration can hold. */
const STORABLE_ID = /^[A-Za-z0-9-]{1,64}$/

/** Within a micrometre, as a device stores an anchor. */
const sameOffset = (left: readonly number[], right: readonly number[]) =>
  Math.abs(left[0] - right[0]) < 0.0005 && Math.abs(left[1] - right[1]) < 0.0005

/**
 * A profile's bed setups' anchors as its device is to store them: each id once, its X and Y
 * from the device's first anchor to a micrometre. Anchors whose id the device cannot hold are
 * left out.
 */
export function anchorsToStore(profile: FixtureProfile): AddedAnchor[] {
  const ids = new Set<string>()
  return profile.bedSetups
    .flatMap((setup) => setup.anchors)
    .flatMap((anchor) => {
      if (ids.has(anchor.id) || !STORABLE_ID.test(anchor.id)) return []
      ids.add(anchor.id)
      const [x, y] = anchor.offset
      return [{ id: anchor.id, offset: [toMicrometre(x), toMicrometre(y)] }]
    })
}

/** Whether two lists hold the same anchors, each at the same place, whatever their order. */
export function sameStoredAnchors(
  left: readonly AddedAnchor[],
  right: readonly AddedAnchor[]
): boolean {
  return (
    left.length === right.length &&
    left.every((anchor) =>
      right.some(
        (other) =>
          other.id === anchor.id && sameOffset(other.offset, anchor.offset)
      )
    )
  )
}

/**
 * Whether a profile's device is to store its bed setups' anchors and, as it was last read or
 * written, does not store them as the profile has them.
 */
export const anchorsToWrite = (profile: FixtureProfile): boolean =>
  !!profile.storeAnchors &&
  !!profile.storedAnchors &&
  !sameStoredAnchors(anchorsToStore(profile), profile.storedAnchors.anchors)

/**
 * A profile with the anchors its device stores besides its own, as a read found them
 * (`configuration.added`), while it is to store its bed setups' anchors: what the device stored
 * when last read or written tells the app's edits since from the device's changes.
 *
 * - An anchor the app has not changed since takes the device's place for it, and so does one
 *   never stored before: the device's is the one measured.
 * - An anchor the app changed keeps the app's place, to be written.
 * - An anchor the device stores that the app removed since stays removed, to be freed.
 * - An anchor the device stores that the app has not had joins the profile's default bed setup,
 *   named by its place after the device's own anchors (`deviceAnchors`), while it has room.
 * - An anchor the app has that the device no longer stores stays, to be written again.
 *
 * Unchanged when the profile does not store anchors, the read has none, or it was merged.
 */
export function storedAnchorsMerged(
  profile: FixtureProfile,
  configuration: AnchorConfiguration,
  deviceAnchors: number
): FixtureProfile {
  const { added, fetchedAt } = configuration
  if (
    !profile.storeAnchors ||
    !added ||
    profile.storedAnchors?.fetchedAt === fetchedAt
  )
    return profile
  const before = profile.storedAnchors?.anchors
  const app = new Map(
    profile.bedSetups
      .flatMap((setup) => setup.anchors)
      .map((anchor) => [anchor.id, anchor])
  )
  const moved = new Map<string, AnchorXY>()
  const joining: BedSetupAnchor[] = []
  for (const stored of added) {
    const held = app.get(stored.id)
    const was = before?.find((anchor) => anchor.id === stored.id)
    if (held) {
      if (!was || sameOffset(held.offset, was.offset))
        moved.set(stored.id, [...stored.offset])
    } else if (!was)
      joining.push({
        id: stored.id,
        name: `Anchor ${deviceAnchors + stored.slot + 1}`,
        offset: [...stored.offset],
      })
  }
  const target = bedSetupOf(profile).id
  const bedSetups = profile.bedSetups.map((setup) => {
    const anchors = setup.anchors.map((anchor) => {
      const offset = moved.get(anchor.id)
      return offset && !sameOffset(offset, anchor.offset)
        ? { ...anchor, offset }
        : anchor
    })
    if (setup.id === target)
      anchors.push(...joining.slice(0, BED_SETUP_ANCHOR_LIMIT - anchors.length))
    return anchors.some((anchor, index) => anchor !== setup.anchors[index]) ||
      anchors.length !== setup.anchors.length
      ? { ...setup, anchors }
      : setup
  })
  return {
    ...profile,
    bedSetups,
    storedAnchors: {
      fetchedAt,
      anchors: added.map(({ id, offset }) => ({ id, offset: [...offset] })),
    },
  }
}
