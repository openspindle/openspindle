import {
  fixturePointOnBed,
  fixtureSupportHeight,
  isBedKind,
  isLocked,
  namedFixtures,
} from "@/domain/fixtures/definitions"
import type { FixtureInstance } from "@/domain/fixtures/definitions"
import { boxMountPoints } from "@/domain/fixtures/mount-points"
import type { MountPoint } from "@/domain/fixtures/mount-points"
import {
  anchorDisplayName,
  bedAnchors,
  bedOffsetOf,
} from "@/domain/anchors/stored-anchors"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"
import type { Stock } from "@/domain/stock/stock"
import { fixtureModelMountPoints, kitForSetup } from "../fixtures/catalog"
import { bedAt } from "../fixtures/machine-bed"
import { fail, ok } from "../primitives"
import type { Point3, Result } from "../primitives"
import type { PlateSetup } from "./plate"

/** Something on a plate's bed that can be selected; fixtures are told apart by their id. */
export type SetupItemRef =
  | { readonly kind: "bed" | "stock" | "design" }
  | { readonly kind: "fixture"; readonly id: string }

export const setupItemKey = (ref: SetupItemRef): string =>
  ref.kind === "fixture" ? `fixture:${ref.id}` : ref.kind

export const sameSetupItem = (a: SetupItemRef | null, b: SetupItemRef | null) =>
  a === b || (a !== null && b !== null && setupItemKey(a) === setupItemKey(b))

/** What setup items are read from: a plate's setup, or the viewer's copy of it. */
export type SetupSubject = {
  readonly stock: Stock | null
  readonly stockAnchor: Point3
  readonly workOrigin: Point3
  readonly fixtures?: readonly FixtureInstance[]
  readonly anchors?: StoredAnchorSetup | null
  /** The device the plate is set up for, whose machine's bed it is on (`kitForSetup`). */
  readonly deviceId?: string | null
}

/**
 * A drawn part of a plate's setup: the machine's bed, the enabled fixtures with a model (a bed
 * fixture among them, on the machine's bed, and wasteboards), the stock and the design (the
 * program, drawn from the work origin).
 */
export type SetupItem = {
  readonly ref: SetupItemRef
  readonly key: string
  readonly name: string
  /** Why the item stays where it is; null when it can be moved. */
  readonly fixed: string | null
  /** Whether a fixture is locked; null for what is never locked (beds and the rest). */
  readonly locked: boolean | null
}

const BED_FIXED = "Beds stay in place."

/** An enabled bed fixture with a model covers the machine's own bed, and its holes. */
const coversMachineBed = (fixtures: readonly FixtureInstance[]) =>
  fixtures.some(
    (instance) =>
      instance.enabled &&
      instance.definition.model !== null &&
      isBedKind(instance.definition.kind)
  )

function fixtureItem(instance: FixtureInstance, name: string): SetupItem {
  const ref = { kind: "fixture", id: instance.id } as const
  const base = { ref, key: setupItemKey(ref), name }
  if (isBedKind(instance.definition.kind))
    return { ...base, fixed: BED_FIXED, locked: null }
  const locked = isLocked(instance)
  return {
    ...base,
    fixed: locked ? `${name} is locked. Unlock it to move it.` : null,
    locked,
  }
}

const plainItem = (
  kind: "bed" | "stock" | "design",
  name: string,
  fixed: string | null
): SetupItem => ({ ref: { kind }, key: kind, name, fixed, locked: null })

/** The plate's drawn setup items, from the bed up. */
export function setupItems(subject: SetupSubject): SetupItem[] {
  const fixtures = subject.fixtures ?? []
  const items: SetupItem[] = [plainItem("bed", "Machine bed", BED_FIXED)]
  // Numbered like the Fixtures panel lists them: the fixtures on the bed.
  const placed = fixtures.filter((instance) => instance.enabled)
  for (const { instance, name } of namedFixtures(placed))
    if (instance.definition.model) items.push(fixtureItem(instance, name))
  if (subject.stock) items.push(plainItem("stock", "Stock", null))
  items.push(plainItem("design", "Design", null))
  return items
}

/** One drawn item; null when the plate no longer draws it. */
export function setupItem(
  subject: SetupSubject,
  ref: SetupItemRef
): SetupItem | null {
  const key = setupItemKey(ref)
  return setupItems(subject).find((item) => item.key === key) ?? null
}

/** Bed coordinates are kept to the nanometre, as datums are shown, without float noise or −0. */
const toNanometre = (value: number) => Number(value.toFixed(6)) + 0

const shifted = (point: Point3, delta: Point3): Point3 =>
  point.map((value, axis) => toNanometre(value + delta[axis])) as Point3

/**
 * The setup after moving an item by `delta` millimetres: a fixture by its position, the stock
 * with the design on it (the work origin moves along), the design alone by its work origin.
 */
export function moveSetupItem(
  setup: PlateSetup,
  ref: SetupItemRef,
  delta: Point3
): Result<PlateSetup> {
  if (!delta.every(Number.isFinite)) return fail("The move is not a distance.")
  const item = setupItem(setup, ref)
  if (!item) return fail("It is no longer on the plate.")
  if (item.fixed) return fail(item.fixed)
  switch (ref.kind) {
    case "fixture":
      return ok({
        ...setup,
        fixtures: setup.fixtures.map((instance) =>
          instance.id === ref.id
            ? { ...instance, position: shifted(instance.position, delta) }
            : instance
        ),
      })
    case "stock":
      return ok({
        ...setup,
        stockAnchor: shifted(setup.stockAnchor, delta),
        workOrigin: shifted(setup.workOrigin, delta),
      })
    case "design":
      return ok({ ...setup, workOrigin: shifted(setup.workOrigin, delta) })
    default:
      return fail(BED_FIXED)
  }
}

/** A point to line up by, in bed millimetres. */
export type SetupPoint = {
  /** Unique on the plate: its item's key and its own id. */
  readonly key: string
  /** The item it belongs to; null for the device's stored anchors. */
  readonly item: SetupItemRef | null
  readonly label: string
  readonly position: Point3
}

/** The extent of a design's cutting moves, in program coordinates (from the work origin). */
export type DesignExtent = { readonly min: Point3; readonly max: Point3 }

/** The work origin, and the corners and centre of the toolpath's footprint on its plane. */
function designMountPoints(
  origin: Point3,
  extent: DesignExtent | null
): MountPoint[] {
  const points: MountPoint[] = [
    { id: "work-origin", name: "Work origin", position: origin },
  ]
  if (!extent) return points
  const at = (fx: number, fy: number): Point3 => [
    origin[0] + extent.min[0] + (extent.max[0] - extent.min[0]) * fx,
    origin[1] + extent.min[1] + (extent.max[1] - extent.min[1]) * fy,
    origin[2],
  ]
  return [
    ...points,
    { id: "front-left", name: "Toolpath front-left", position: at(0, 0) },
    { id: "front-right", name: "Toolpath front-right", position: at(1, 0) },
    { id: "back-left", name: "Toolpath back-left", position: at(0, 1) },
    { id: "back-right", name: "Toolpath back-right", position: at(1, 1) },
    { id: "center", name: "Toolpath center", position: at(0.5, 0.5) },
  ]
}

/**
 * A drawn item's own mount points on the bed: the machine bed's holes and corners where no bed
 * fixture covers it, a fixture's where it stands, the stock's box, the design's work origin and
 * toolpath corners.
 */
export function ownMountPoints(
  subject: SetupSubject,
  ref: SetupItemRef,
  design: DesignExtent | null
): readonly MountPoint[] {
  const fixtures = subject.fixtures ?? []
  switch (ref.kind) {
    case "bed": {
      // Under a bed fixture, only that bed's own holes are reachable.
      if (coversMachineBed(fixtures)) return []
      const kit = kitForSetup({ deviceId: subject.deviceId ?? null, fixtures })
      return bedAt(kit.bed, bedOffsetOf(subject.anchors)).mountPoints
    }
    case "fixture": {
      const instance = fixtures.find((item) => item.id === ref.id)
      const model = instance?.definition.model
      if (!instance || !model) return []
      return fixtureModelMountPoints(model).map((point) => ({
        ...point,
        position: fixturePointOnBed(instance, point.position),
      }))
    }
    case "stock": {
      const { stock, stockAnchor } = subject
      if (!stock) return []
      return boxMountPoints({
        min: stockAnchor,
        max: [
          stockAnchor[0] + stock.width,
          stockAnchor[1] + stock.depth,
          stockAnchor[2] + stock.height,
        ],
      })
    }
    case "design":
      return designMountPoints(subject.workOrigin, design)
  }
}

/**
 * Every point a move can line up by: the mount points of each drawn item, and the device's
 * stored anchors on the support, where the viewer marks them.
 */
export function setupPoints(
  subject: SetupSubject,
  design: DesignExtent | null
): SetupPoint[] {
  const points = setupItems(subject).flatMap((item) =>
    ownMountPoints(subject, item.ref, design).map((point): SetupPoint => ({
      key: `${item.key}/${point.id}`,
      item: item.ref,
      label: `${item.name} · ${point.name}`,
      position: point.position,
    }))
  )
  const fixtures = subject.fixtures ?? []
  const z = fixtureSupportHeight(
    fixtures,
    kitForSetup({ deviceId: subject.deviceId ?? null, fixtures }).tableTop
  )
  const factory = subject.anchors?.source === "factory"
  for (const anchor of bedAnchors(subject.anchors ?? undefined))
    points.push({
      key: `anchor/${anchor.id}`,
      item: null,
      label: anchorDisplayName(anchor, factory),
      position: [anchor.position[0], anchor.position[1], z],
    })
  return points
}

/** Which coordinates a move changes. */
export const MOVE_AXES = ["xy", "x", "y", "z", "xyz"] as const
export type MoveAxes = (typeof MOVE_AXES)[number]

export const MOVE_AXES_LABELS: Record<MoveAxes, string> = {
  xy: "X and Y",
  x: "X only",
  y: "Y only",
  z: "Z only",
  xyz: "X, Y and Z",
}

const AXIS_MASKS: Record<MoveAxes, readonly [boolean, boolean, boolean]> = {
  xy: [true, true, false],
  x: [true, false, false],
  y: [false, true, false],
  z: [false, false, true],
  xyz: [true, true, true],
}

export const moveAxesMask = (axes: MoveAxes) => AXIS_MASKS[axes]

/** The move that puts `from` on `to` along the axes; the other coordinates stay. */
export function alignment(from: Point3, to: Point3, axes: MoveAxes): Point3 {
  const mask = AXIS_MASKS[axes]
  return from.map((value, axis) =>
    mask[axis] ? to[axis] - value : 0
  ) as Point3
}
