import { z } from "zod"
import {
  BED_SETUP_ANCHOR_LIMIT,
  BedSetupAnchorSchema,
  StoredAnchorSetupSchema,
  bedSetupAnchorsOf,
  deviceAnchorsOf,
} from "../anchors/stored-anchors"
import type {
  BedSetupAnchor,
  StoredAnchorSetup,
} from "../anchors/stored-anchors"
import { plateAnchors } from "../plate/bed-setup"
import type { BedSetupAnchors } from "../plate/bed-setup"
import type { Plate, PlateSetup } from "../plate/plate"
import { withAnchors } from "../plate/work-origin"
import { EntityIdSchema } from "../primitives"

/** The project's device and its last known placement data, independent of local libraries. */
export const ProjectProfileSchema = z
  .object({
    deviceId: EntityIdSchema.nullable(),
    bedSetupId: EntityIdSchema.nullable(),
    anchors: StoredAnchorSetupSchema.nullable(),
    bedSetups: z.record(
      EntityIdSchema,
      z.array(BedSetupAnchorSchema).max(BED_SETUP_ANCHOR_LIMIT)
    ),
  })
  .refine(
    (profile) =>
      !profile.anchors || profile.anchors.deviceId === profile.deviceId,
    "Project anchors belong to another device."
  )

export type ProjectProfile = {
  readonly deviceId: string | null
  readonly bedSetupId: string | null
  readonly anchors: StoredAnchorSetup | null
  readonly bedSetups: BedSetupAnchors
}

/** Earlier projects use their first plate's device; an empty project uses Workspace defaults. */
export function projectProfileOf(plates: readonly Plate[]): ProjectProfile {
  const setup = plates.at(0)?.setup
  const deviceId = setup?.deviceId ?? null
  const bedSetups: Record<string, BedSetupAnchor[]> = {}
  for (const plate of plates) {
    const held = plate.setup
    if (
      held.deviceId === deviceId &&
      held.bedSetupId &&
      held.anchors &&
      !Object.hasOwn(bedSetups, held.bedSetupId)
    )
      bedSetups[held.bedSetupId] = bedSetupAnchorsOf(held.anchors)
  }
  return {
    deviceId,
    bedSetupId: setup?.bedSetupId ?? null,
    anchors: setup?.anchors
      ? { ...setup.anchors, anchors: deviceAnchorsOf(setup.anchors) }
      : null,
    bedSetups,
  }
}

/** A plate adopts the project's device without changing stock, operations or placed fixtures. */
export function setupOnProject(
  setup: PlateSetup,
  profile: ProjectProfile,
  refresh = false
): PlateSetup {
  const sameDevice = setup.deviceId === profile.deviceId
  if (sameDevice && !refresh) return setup
  const bedSetupId = sameDevice
    ? (setup.bedSetupId ?? null)
    : profile.bedSetupId
  let anchors = sameDevice ? setup.anchors : null
  if (profile.anchors)
    anchors = plateAnchors(
      { bedSetupId, anchors },
      profile.anchors,
      profile.bedSetups
    )
  if (
    sameDevice &&
    (setup.bedSetupId ?? null) === bedSetupId &&
    JSON.stringify(setup.anchors) === JSON.stringify(anchors)
  )
    return setup
  return {
    ...withAnchors(setup, anchors),
    deviceId: profile.deviceId,
    bedSetupId,
  }
}
