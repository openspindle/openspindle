import { z } from "zod"
import type { AnchorConfiguration, AnchorPosition } from "@/machine/contract"
import {
  COORDINATE_LIMIT,
  CoordinateSchema,
  EntityIdSchema,
  TextSchema,
} from "@/domain/primitives"
import type { Transform } from "@/domain/geometry/frame"

/** X and Y in millimetres, on the bed or the machine, bounded like bed coordinates. */
export const AnchorXYSchema = z.tuple([CoordinateSchema, CoordinateSchema])
export type AnchorXY = z.infer<typeof AnchorXYSchema>

/**
 * A position the machine stores: its id, which never changes, its name and machine XY. One a
 * bed setup keeps instead (`bedSetup`) is at the first anchor plus its offset.
 */
export const StoredAnchorSchema = z.object({
  id: EntityIdSchema,
  name: TextSchema,
  machinePosition: AnchorXYSchema,
  /** Kept by the plate's bed setup, from the first anchor, rather than stored by the device. */
  bedSetup: z.literal(true).optional(),
})
export type StoredAnchor = z.infer<typeof StoredAnchorSchema>

/** The most anchors a device's snapshot keeps, as many as a machine reports. */
export const ANCHOR_LIMIT = 32

/** The most anchors a bed setup keeps of its own. */
export const BED_SETUP_ANCHOR_LIMIT = 16

/** An anchor a bed setup keeps: its X and Y from the device's first anchor, Anchor 1 on the Z1. */
export const BedSetupAnchorSchema = z.object({
  id: EntityIdSchema,
  name: TextSchema,
  offset: AnchorXYSchema,
})
export type BedSetupAnchor = z.infer<typeof BedSetupAnchorSchema>

/**
 * A snapshot of a machine's anchors, as plates and device profiles keep it: the kit's factory
 * defaults, or a read of the device, which names the device and when it was read. Its first
 * anchor is the bed's origin (`machineToBed`).
 */
export const StoredAnchorSetupSchema = z
  .object({
    version: z.literal(2),
    deviceId: EntityIdSchema.nullable(),
    source: z.enum(["factory", "firmware-config"]),
    fetchedAt: z.number().min(0).optional(),
    /**
     * How far the machine's bed (its model and holes) sits from where its kit places it from the
     * first anchor, in X and Y; [0, 0] where the kit has it.
     */
    bedOffset: AnchorXYSchema,
    /** The device's anchors, then those of the plate's bed setup (`withBedSetupAnchors`). */
    anchors: z
      .array(StoredAnchorSchema)
      .min(1)
      .max(ANCHOR_LIMIT + BED_SETUP_ANCHOR_LIMIT),
  })
  .superRefine((setup, context) => {
    const kept = setup.anchors.filter((anchor) => anchor.bedSetup)
    const device = setup.anchors.length - kept.length
    if (
      setup.anchors[0].bedSetup ||
      setup.anchors.slice(device).some((anchor) => !anchor.bedSetup) ||
      device > ANCHOR_LIMIT ||
      kept.length > BED_SETUP_ANCHOR_LIMIT
    )
      context.addIssue({
        code: "custom",
        message: `The device's anchors come first, at most ${ANCHOR_LIMIT}, then at most ${BED_SETUP_ANCHOR_LIMIT} of its bed setup.`,
        path: ["anchors"],
      })
    if (
      setup.source === "firmware-config" &&
      (setup.deviceId === null || setup.fetchedAt === undefined)
    )
      context.addIssue({
        code: "custom",
        message:
          "Anchors read from a device need its id and the time of the read.",
        path: ["source"],
      })
    const ids = new Set(setup.anchors.map((anchor) => anchor.id))
    if (ids.size !== setup.anchors.length)
      context.addIssue({
        code: "custom",
        message: "Anchor ids repeat.",
        path: ["anchors"],
      })
    if (!bedAnchors(setup).every((anchor) => isAnchorXY(anchor.position)))
      context.addIssue({
        code: "custom",
        message: `The anchors lie more than ${COORDINATE_LIMIT} mm from the bed's origin.`,
        path: ["anchors"],
      })
  })
export type StoredAnchorSetup = z.infer<typeof StoredAnchorSetupSchema>

/** The same device and bed frame, including kept anchors, regardless of when it was read. */
export function sameAnchorFrame(
  a: StoredAnchorSetup | null | undefined,
  b: StoredAnchorSetup | null | undefined
): boolean {
  if (!a || !b) return a === b
  return (
    a.deviceId === b.deviceId &&
    a.source === b.source &&
    a.bedOffset.every((value, axis) => value === b.bedOffset[axis]) &&
    a.anchors.length === b.anchors.length &&
    a.anchors.every((anchor, index) => {
      const other = b.anchors[index]
      return (
        anchor.id === other.id &&
        anchor.name === other.name &&
        anchor.bedSetup === other.bedSetup &&
        anchor.machinePosition.every(
          (value, axis) => value === other.machinePosition[axis]
        )
      )
    })
  )
}

export type BedAnchor = {
  id: string
  name: string
  position: AnchorXY
  /** Kept by the plate's bed setup rather than stored by the device. */
  bedSetup?: true
}

export const isAnchorXY = (value: unknown): value is AnchorXY =>
  AnchorXYSchema.safeParse(value).success

export const isStoredAnchorSetup = (
  value: unknown
): value is StoredAnchorSetup =>
  StoredAnchorSetupSchema.safeParse(value).success

/** The anchors read from a device, with its bed `bedOffset` from where its kit places it. */
export function anchorsFromDevice(
  configuration: AnchorConfiguration,
  deviceId: string,
  bedOffset: AnchorXY = [0, 0]
): StoredAnchorSetup {
  return {
    version: 2,
    deviceId,
    source: "firmware-config",
    fetchedAt: configuration.fetchedAt,
    bedOffset: [...bedOffset],
    anchors: configuration.anchors.map((anchor) => ({
      id: anchor.id,
      name: anchor.name,
      machinePosition: [anchor.x, anchor.y],
    })),
  }
}

/**
 * Machine XY on the bed: the bed's origin is the setup's first anchor (Anchor 1 on the Z1), so a
 * bed position is its distance from that anchor.
 */
export function machineToBed(
  setup: Pick<StoredAnchorSetup, "anchors">
): Transform<"machine", "bed"> {
  const reference = setup.anchors[0].machinePosition
  return (point) => [
    Number((point[0] - reference[0]).toFixed(6)) + 0,
    Number((point[1] - reference[1]).toFixed(6)) + 0,
  ]
}

/** How far a plate's or profile's machine bed sits from where its kit places it; none without anchors. */
export const bedOffsetOf = (setup?: StoredAnchorSetup | null): AnchorXY =>
  setup?.bedOffset ?? [0, 0]

export function bedAnchors(setup?: StoredAnchorSetup): BedAnchor[] {
  if (!setup?.anchors.length) return []
  const toBed = machineToBed(setup)
  return setup.anchors.map((anchor) => ({
    id: anchor.id,
    name: anchor.name,
    position: [...toBed(anchor.machinePosition)] as AnchorXY,
    ...(anchor.bedSetup && { bedSetup: true }),
  }))
}

/**
 * A bed anchor's name, marked the same way wherever the factory defaults gave it: a device's
 * anchor in a factory snapshot, never one its bed setup keeps.
 */
export function anchorDisplayName(
  anchor: Pick<BedAnchor, "name" | "bedSetup">,
  factory: boolean
): string {
  return `${anchor.name}${factory && !anchor.bedSetup ? " (default)" : ""}`
}

/**
 * A device's anchors (machine X and Y) with one moved to `position`, as a probing found it. The
 * others stay where they are, unless the first moves and they follow it (`follow`): the Z1 stores
 * Anchor 2 as its offset from Anchor 1, so its own configuration has it move along.
 */
export function withMovedAnchor(
  anchors: readonly AnchorPosition[],
  anchorId: string,
  position: readonly [number, number],
  follow: boolean
): AnchorPosition[] {
  const moved = anchors.find((anchor) => anchor.id === anchorId)
  if (!moved) return [...anchors]
  const [dx, dy] = [position[0] - moved.x, position[1] - moved.y]
  const first = anchors[0]?.id === anchorId
  return anchors.map((anchor) => {
    if (anchor.id === anchorId)
      return { id: anchor.id, x: position[0], y: position[1] }
    return first && follow
      ? { id: anchor.id, x: anchor.x + dx, y: anchor.y + dy }
      : { id: anchor.id, x: anchor.x, y: anchor.y }
  })
}

/** The anchors a snapshot has from its device, without those of a bed setup. */
export const deviceAnchorsOf = (setup: Pick<StoredAnchorSetup, "anchors">) =>
  setup.anchors.filter((anchor) => !anchor.bedSetup)

/**
 * A snapshot with a bed setup's anchors after the device's, each at the first anchor plus its
 * offset; any it had of another bed setup go.
 */
export function withBedSetupAnchors(
  setup: StoredAnchorSetup,
  anchors: readonly BedSetupAnchor[]
): StoredAnchorSetup {
  const device = deviceAnchorsOf(setup)
  const [x, y] = device[0].machinePosition
  return {
    ...setup,
    anchors: [
      ...device,
      ...anchors.map((anchor): StoredAnchor => ({
        id: anchor.id,
        name: anchor.name,
        machinePosition: [
          Number((x + anchor.offset[0]).toFixed(6)) + 0,
          Number((y + anchor.offset[1]).toFixed(6)) + 0,
        ],
        bedSetup: true,
      })),
    ],
  }
}

/** The bed setup's anchors a snapshot holds, as offsets from its first anchor. */
export function bedSetupAnchorsOf(setup: StoredAnchorSetup): BedSetupAnchor[] {
  const [x, y] = setup.anchors[0].machinePosition
  return setup.anchors
    .filter((anchor) => anchor.bedSetup)
    .map((anchor) => ({
      id: anchor.id,
      name: anchor.name,
      offset: [
        Number((anchor.machinePosition[0] - x).toFixed(6)) + 0,
        Number((anchor.machinePosition[1] - y).toFixed(6)) + 0,
      ],
    }))
}
