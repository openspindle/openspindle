import { isAnchorConfiguration } from "@/machine/contract"
import { anchorsFromDevice, bedAnchors } from "@/domain/anchors/stored-anchors"
import type {
  AnchorXY,
  StoredAnchor,
  StoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import { WORK_ORIGIN_SUBJECT, error } from "../diagnostics"
import type { Diagnostic } from "../diagnostics"
import type { FixtureKit } from "../fixtures/fixture-kit"
import type { RunContext } from "../operations/kinds"
import type { Point3 } from "../primitives"
import type { Plate, PlateSetup } from "./plate"

/** Bed coordinates are kept to the nanometre, without float noise or −0. */
const toNanometre = (value: number) => Number(value.toFixed(6)) + 0

/** Whether a plate sets its work Z by touching off the stock top (auto Z-height). */
export const touchesOffWorkZ = (plate: Pick<Plate, "operations">) =>
  plate.operations.some(
    (operation) => operation.source.kind === "auto-z-height"
  )

/**
 * A plate that touches off machines from work Z0 on the stock top, which the touch sets: its
 * work origin's Z stays there, whatever moved the stock or the origin. Plates without stock,
 * or without a touch-off, keep theirs; an unchanged plate keeps its identity.
 */
export function withTouchedWorkOrigin(plate: Plate): Plate {
  const { stock, stockAnchor, workOrigin } = plate.setup
  if (!stock || !touchesOffWorkZ(plate)) return plate
  const top = toNanometre(stockAnchor[2] + stock.height)
  if (Math.abs(workOrigin[2] - top) < 1e-6) return plate
  return {
    ...plate,
    setup: { ...plate.setup, workOrigin: [workOrigin[0], workOrigin[1], top] },
  }
}

/** Where one of a plate's stored anchors is on the bed; null when the plate does not have it. */
export function anchorOnBed(
  anchors: StoredAnchorSetup | null | undefined,
  anchorId: string
): AnchorXY | null {
  return (
    bedAnchors(anchors ?? undefined).find((anchor) => anchor.id === anchorId)
      ?.position ?? null
  )
}

/** The stored anchor a point's X and Y are kept relative to, and where it is on the bed. */
export type AnchorReference = { anchorId: string; position: AnchorXY }

/** The anchor a point is kept relative to, where it is; null for bed coordinates. */
export function anchorReference(
  anchors: StoredAnchorSetup | null | undefined,
  anchorId: string | null | undefined
): AnchorReference | null {
  if (!anchorId) return null
  const position = anchorOnBed(anchors, anchorId)
  return position ? { anchorId, position } : null
}

/** A bed point as offsets from its anchor in X and Y (Z stays on the bed). */
export function offsetFromAnchor(
  [x, y, z]: Point3,
  reference: AnchorReference | null
): Point3 {
  if (!reference) return [x, y, z]
  const [ax, ay] = reference.position
  return [toNanometre(x - ax), toNanometre(y - ay), z]
}

/** The bed point for offsets from an anchor (bed coordinates without one). */
export function pointFromOffset(
  [x, y, z]: Point3,
  reference: AnchorReference | null
): Point3 {
  if (!reference) return [x, y, z]
  const [ax, ay] = reference.position
  return [toNanometre(x + ax), toNanometre(y + ay), z]
}

/** The anchor a plate's work origin is kept relative to, where it is; null for bed coordinates. */
export function workOriginReference(
  setup: Pick<PlateSetup, "anchors" | "workOriginAnchor">
): AnchorReference | null {
  return anchorReference(setup.anchors, setup.workOriginAnchor)
}

/** The work origin as offsets from its anchor in X and Y (Z stays on the bed). */
export function workOriginOffset(setup: PlateSetup): Point3 {
  return offsetFromAnchor(setup.workOrigin, workOriginReference(setup))
}

/**
 * A point kept relative to one of the `before` anchors, with the `after` ones: it moves with its
 * anchor, keeping its offsets, or stays where it is, in bed coordinates, when that anchor is
 * gone. Null for a point in bed coordinates.
 */
function followAnchor(
  point: Point3,
  anchorId: string | null | undefined,
  before: StoredAnchorSetup | null,
  after: StoredAnchorSetup | null
): { point: Point3; anchorId: string | null } | null {
  const reference = anchorReference(before, anchorId)
  if (!reference) return null
  const moved = anchorOnBed(after, reference.anchorId)
  if (!moved) return { point, anchorId: null }
  const [x, y, z] = point
  return {
    point: [
      toNanometre(x + moved[0] - reference.position[0]),
      toNanometre(y + moved[1] - reference.position[1]),
      z,
    ],
    anchorId: reference.anchorId,
  }
}

/**
 * The setup with other anchors. The work origin, the stock and fixtures kept relative to an
 * anchor move with it, keeping their offsets; one whose anchor is gone stays where it is, in bed
 * coordinates. Everything else stays where it is.
 */
export function withAnchors(
  setup: PlateSetup,
  anchors: StoredAnchorSetup | null
): PlateSetup {
  const follow = (point: Point3, anchorId: string | null | undefined) =>
    followAnchor(point, anchorId, setup.anchors, anchors)
  const origin = follow(setup.workOrigin, setup.workOriginAnchor)
  const stock = follow(setup.stockAnchor, setup.stockRelativeTo)
  return {
    ...setup,
    anchors,
    ...(origin && {
      workOrigin: origin.point,
      workOriginAnchor: origin.anchorId,
    }),
    ...(stock && { stockAnchor: stock.point, stockRelativeTo: stock.anchorId }),
    fixtures: setup.fixtures.map((instance) => {
      const fixture = follow(instance.position, instance.relativeTo)
      if (!fixture) return instance
      return {
        ...instance,
        position: fixture.point,
        relativeTo: fixture.anchorId,
      }
    }),
  }
}

/** An anchor-relative work origin on the machine: its anchor, the offsets and machine X/Y. */
export type MachineOrigin = {
  readonly anchor: StoredAnchor
  readonly offset: AnchorXY
  readonly position: AnchorXY
  /** Whether the anchor is the machine's factory default rather than read from it. */
  readonly factory: boolean
}

/**
 * Where a work origin kept relative to an anchor is on the machine: the anchor's stored machine
 * position plus the offsets. Null in bed coordinates.
 */
export function workOriginOnMachine(setup: PlateSetup): MachineOrigin | null {
  const reference = workOriginReference(setup)
  const anchor = setup.anchors?.anchors.find(
    (item) => item.id === reference?.anchorId
  )
  if (!reference || !anchor) return null
  const [dx, dy] = workOriginOffset(setup)
  const [mx, my] = anchor.machinePosition
  return {
    anchor,
    offset: [dx, dy],
    position: [toNanometre(mx + dx), toNanometre(my + dy)],
    factory: setup.anchors?.source === "factory",
  }
}

/**
 * The NC that puts the machine's work X and Y on a work origin kept relative to an anchor, run
 * before the program's operations: its machine kit's (`FixtureKit.workOffsetNc`). Z stays: the
 * work zero set on Device, or an auto Z-height touch-off, sets it. Empty in bed coordinates.
 */
export function workOriginNc(
  setup: PlateSetup,
  kit: Pick<FixtureKit, "workOffsetNc">
): readonly string[] {
  const origin = workOriginOnMachine(setup)
  return origin ? kit.workOffsetNc(origin) : []
}

const readAnchors = (code: string, message: string): Diagnostic[] => [
  error(`work-origin/${code}`, message, {
    subject: WORK_ORIGIN_SUBJECT,
    fix: { kind: "read-anchors" },
  }),
]

/**
 * What blocks Run for a work origin set from an anchor: its anchors must have been read from
 * the connected device, which the plate is set up for, and still be the device's current ones;
 * otherwise the work offset would land where the machine's anchor is not.
 */
export function workOriginRunChecks(
  setup: PlateSetup,
  machine: RunContext
): Diagnostic[] {
  const origin = workOriginOnMachine(setup)
  if (!origin) return []
  const { anchors, deviceId } = setup
  const connected = machine.connectedDeviceId
  if (
    !connected ||
    deviceId !== connected ||
    anchors?.source !== "firmware-config" ||
    anchors.deviceId !== connected
  )
    return readAnchors(
      "anchors-not-read",
      `The work origin is set from ${origin.anchor.name}: use Read anchors to load the connected device's anchors before Run.`
    )
  if (!isAnchorConfiguration(machine.anchors))
    return readAnchors(
      "live-anchors-unavailable",
      "Use Read anchors to load the connected device's current stored anchors before Run."
    )
  const live = anchorsFromDevice(machine.anchors, connected).anchors.find(
    (anchor) => anchor.id === origin.anchor.id
  )
  const moved =
    !live ||
    live.machinePosition.some(
      (value, axis) =>
        Math.abs(value - origin.anchor.machinePosition[axis]) > 1e-6
    )
  if (moved)
    return readAnchors(
      "anchors-changed",
      "Stored anchors changed. Use Read anchors before Run."
    )
  return []
}
