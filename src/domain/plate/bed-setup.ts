import {
  bedSetupAnchorsOf,
  withBedSetupAnchors,
} from "@/domain/anchors/stored-anchors"
import type {
  BedSetupAnchor,
  StoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import type { PlateSetup } from "./plate"

/** A device's bed setups' anchors, by bed setup id, as plates on them keep them. */
export type BedSetupAnchors = Readonly<
  Record<string, readonly BedSetupAnchor[]>
>

/**
 * The anchors a plate keeps on a device: the device's (`device`), then those of its bed setup,
 * as the device's profile has them (`bedSetups`), or as the plate keeps them when the profile has
 * no bed setup of its id, such as a plate set up on another computer.
 */
export function plateAnchors(
  setup: Pick<PlateSetup, "anchors" | "bedSetupId">,
  device: StoredAnchorSetup,
  bedSetups: BedSetupAnchors
): StoredAnchorSetup {
  const id = setup.bedSetupId
  const known = id && Object.hasOwn(bedSetups, id) ? bedSetups[id] : null
  return withBedSetupAnchors(
    structuredClone(device),
    known ?? (setup.anchors ? bedSetupAnchorsOf(setup.anchors) : [])
  )
}
