import { isAnchorConfiguration } from "@/machine/contract"
import type { RuleFixes } from "@/machine/contract"
import {
  anchorsFromDevice,
  bedAnchors,
  deviceAnchorsOf,
} from "@/domain/anchors/stored-anchors"
import type {
  AnchorXY,
  StoredAnchor,
  StoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import { WORK_ORIGIN_SUBJECT } from "../diagnostics"
import type { QuickFix } from "../diagnostics"
import type { FixtureKit } from "../fixtures/fixture-kit"
import type { Point3 } from "../primitives"
import type { RunRuleSubject, StageRule } from "../rules/stages"
import type { Plate, PlateSetup } from "./plate"

/** Bed coordinates are kept to the nanometre, without float noise or −0. */
const toNanometre = (value: number) => Number(value.toFixed(6)) + 0

/** Whether a plate sets its work Z by touching off the stock top (a touch-off). */
export const touchesOffWorkZ = (plate: Pick<Plate, "operations">) =>
  plate.operations.some(
    ({ source }) => source.kind === "probing" && source.task === "touch-off"
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

/** A work origin on the machine: the anchor it is placed from, the offsets and machine X/Y. */
export type MachineOrigin = {
  readonly anchor: StoredAnchor
  readonly offset: AnchorXY
  readonly position: AnchorXY
  /** Whether the anchor is the machine's factory default rather than read from it. */
  readonly factory: boolean
}

/**
 * The anchor a work origin is placed from on the machine: the one it is kept relative to, or for
 * the bed origin (bed coordinates) the first anchor, once the anchors are read from the plate's
 * device. Null at the bed origin on factory or another device's anchors: its work X and Y are set
 * on Device.
 */
function machineReference(setup: PlateSetup): AnchorReference | null {
  if (setup.workOriginAnchor) return workOriginReference(setup)
  const { anchors, deviceId } = setup
  if (
    !anchors ||
    anchors.source !== "firmware-config" ||
    anchors.deviceId !== deviceId
  )
    return null
  return anchorReference(anchors, anchors.anchors[0]?.id)
}

/**
 * Where a work origin is on the machine: its anchor's stored machine position plus the offsets.
 * Null at the bed origin when its anchors were not read from the plate's device.
 */
export function workOriginOnMachine(setup: PlateSetup): MachineOrigin | null {
  const reference = machineReference(setup)
  const anchor = setup.anchors?.anchors.find(
    (item) => item.id === reference?.anchorId
  )
  if (!reference || !anchor) return null
  const [dx, dy] = offsetFromAnchor(setup.workOrigin, reference)
  const [mx, my] = anchor.machinePosition
  return {
    anchor,
    offset: [dx, dy],
    position: [toNanometre(mx + dx), toNanometre(my + dy)],
    factory: setup.anchors?.source === "factory",
  }
}

/**
 * The NC that puts the machine's work X and Y on the plate's work origin (`workOriginOnMachine`),
 * run before the program's operations: its machine kit's (`FixtureKit.workOffsetNc`). Z stays:
 * the work zero set on Device, or a probing touch-off, sets it. Empty where work X and Y are set
 * on Device.
 */
export function workOriginNc(
  setup: PlateSetup,
  kit: Pick<FixtureKit, "workOffsetNc">
): readonly string[] {
  const origin = workOriginOnMachine(setup)
  return origin ? kit.workOffsetNc(origin) : []
}

/** The work origin Run's plate subject sets from an anchor; null for an operation, without a plate, or where work X and Y are set on Device. */
function anchoredOrigin({
  plate,
  operation,
}: RunRuleSubject): { setup: PlateSetup; origin: MachineOrigin } | null {
  if (!plate || operation) return null
  const origin = workOriginOnMachine(plate.setup)
  return origin && { setup: plate.setup, origin }
}

/** The work origin's gates before Run: a failure stops its later ones. */
const WORK_ORIGIN_CHAIN = "work-origin"

/** What each of the work origin's failures offers: reading the connected device's anchors. */
const readAnchors: RuleFixes<RunRuleSubject, QuickFix> = {
  offer: () => [{ kind: "read-anchors" }],
}

const anchorsNotRead: StageRule<"run"> = {
  id: "work-origin/anchors-not-read",
  stage: "run",
  label: "Work origin anchors read",
  description:
    "A work origin set from an anchor needs its anchors read from the connected device, which the plate is set up for; otherwise the work offset lands where the machine's anchor is not.",
  severity: "error",
  configurable: false,
  chain: WORK_ORIGIN_CHAIN,
  test: (subject) => {
    const anchored = anchoredOrigin(subject)
    if (!anchored) return true
    const { anchors, deviceId } = anchored.setup
    const connected = subject.machine.connectedDeviceId
    return (
      !!connected &&
      deviceId === connected &&
      anchors?.source === "firmware-config" &&
      anchors.deviceId === connected
    )
  },
  explain: ({ first }) => ({
    problem: `The work origin is set from ${anchoredOrigin(first)?.origin.anchor.name ?? "an anchor"}: use Read anchors to load the connected device's anchors before Run.`,
    about: WORK_ORIGIN_SUBJECT,
  }),
  fixes: readAnchors,
}

const liveAnchorsUnavailable: StageRule<"run"> = {
  id: "work-origin/live-anchors-unavailable",
  stage: "run",
  label: "Work origin anchors loaded",
  description:
    "A work origin set from an anchor is checked against the connected device's current stored anchors, which Read anchors loads.",
  severity: "error",
  configurable: false,
  chain: WORK_ORIGIN_CHAIN,
  test: (subject) =>
    !anchoredOrigin(subject) || isAnchorConfiguration(subject.machine.anchors),
  explain: () => ({
    problem:
      "Use Read anchors to load the connected device's current stored anchors before Run.",
    about: WORK_ORIGIN_SUBJECT,
  }),
  fixes: readAnchors,
}

const anchorsChanged: StageRule<"run"> = {
  id: "work-origin/anchors-changed",
  stage: "run",
  label: "Work origin anchor unchanged",
  description:
    "The anchor a work origin is set from (for an anchor of the plate's bed setup, the first it is kept from) must still be where the connected device stores it; otherwise the work offset lands where the machine's anchor is not.",
  severity: "error",
  configurable: false,
  chain: WORK_ORIGIN_CHAIN,
  test: (subject) => {
    const anchored = anchoredOrigin(subject)
    const { connectedDeviceId, anchors } = subject.machine
    if (!anchored || !connectedDeviceId || !isAnchorConfiguration(anchors))
      return true
    // An anchor the plate's bed setup keeps is the first device anchor plus its offset.
    const { setup, origin } = anchored
    const anchor =
      origin.anchor.bedSetup && setup.anchors
        ? deviceAnchorsOf(setup.anchors)[0]
        : origin.anchor
    const live = anchorsFromDevice(anchors, connectedDeviceId).anchors.find(
      (item) => item.id === anchor.id
    )
    return (
      !!live &&
      !live.machinePosition.some(
        (value, axis) => Math.abs(value - anchor.machinePosition[axis]) > 1e-6
      )
    )
  },
  explain: () => ({
    problem: "Stored anchors changed. Use Read anchors before Run.",
    about: WORK_ORIGIN_SUBJECT,
  }),
  fixes: readAnchors,
}

/**
 * What Run needs of a work origin set from an anchor: its anchors read from the connected
 * device, which the plate is set up for, and still the device's current ones; otherwise the work
 * offset would land where the machine's anchor is not.
 */
export const WORK_ORIGIN_RULES: readonly StageRule<"run">[] = [
  anchorsNotRead,
  liveAnchorsUnavailable,
  anchorsChanged,
]
