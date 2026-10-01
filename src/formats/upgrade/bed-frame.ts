import { LEGACY_BED_FRAME } from "@/domain/fixtures/makera-z1/makera-z1"
import { isJsonObject } from "./json"
import type { JsonObject } from "./json"

/** Millimetres kept to the nanometre, without float noise or −0, as bed positions are. */
const toNanometre = (value: number) => Number(value.toFixed(6)) + 0

const isXY = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((item) => typeof item === "number" && Number.isFinite(item))

const isPoint = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((item) => typeof item === "number" && Number.isFinite(item))

/** A bed point less `shift`; anything else as it is, for reading to report. */
const shifted = (point: unknown, [dx, dy, dz]: readonly number[]) =>
  isPoint(point)
    ? [
        toNanometre(point[0] - dx),
        toNanometre(point[1] - dy),
        toNanometre(point[2] - dz),
      ]
    : point

/** A fixture instance moved by `shift`, its definition's default position too. */
function shiftedFixture(
  fixture: unknown,
  shift: readonly number[],
  origin: unknown
): unknown {
  if (!isJsonObject(fixture)) return fixture
  const definition = isJsonObject(fixture.definition)
    ? {
        ...fixture.definition,
        defaultPosition: shifted(fixture.definition.defaultPosition, shift),
      }
    : fixture.definition
  return {
    ...fixture,
    definition,
    position: shifted(fixture.position, shift),
    ...(Object.hasOwn(fixture, "relativeTo") && {
      relativeTo: fromOrigin(fixture.relativeTo, origin),
    }),
  }
}

/** A reference to the bed's origin, its first anchor, as bed coordinates (null). */
const fromOrigin = (anchorId: unknown, origin: unknown) =>
  anchorId === origin ? null : anchorId

/**
 * An anchor snapshot of version 1 in version 2: where its alignment put Anchor 1 on the bed
 * becomes how far the bed sits from where the kit places it. Anything else as it is.
 */
function upgradeAnchors(anchors: unknown, anchor1: readonly number[]): unknown {
  if (!isJsonObject(anchors) || anchors.version !== 1) return anchors
  const { anchor1BedPosition: _alignment, ...rest } = anchors
  return {
    ...rest,
    version: 2,
    bedOffset: [
      toNanometre(LEGACY_BED_FRAME.anchor1[0] - anchor1[0]),
      toNanometre(LEGACY_BED_FRAME.anchor1[1] - anchor1[1]),
    ],
  }
}

/** A probing operation's start height, a height on the bed, less `dz`. */
function shiftedOperation(operation: unknown, dz: number): unknown {
  if (!isJsonObject(operation) || !isJsonObject(operation.source))
    return operation
  const { source } = operation
  if (source.kind !== "probing" || !isJsonObject(source.params))
    return operation
  const { placement } = source.params
  if (!isJsonObject(placement) || typeof placement.height !== "number")
    return operation
  return {
    ...operation,
    source: {
      ...source,
      params: {
        ...source.params,
        placement: {
          ...placement,
          height: toNanometre(placement.height - dz),
        },
      },
    },
  }
}

/**
 * A plate saved before project format 9 (plate exports before version 8), whose bed coordinates
 * had the work area's front-left corner at the origin and Z 0 on the aluminium bed
 * (`LEGACY_BED_FRAME`), in bed coordinates from Anchor 1 with Z 0 on the MDF bed's top: its
 * stock, work origin, fixtures (with their definitions' default positions) and probing start
 * heights moved by where its anchor snapshot put Anchor 1 (the kit's (12, 12) without one) and by
 * the MDF bed's height. Points kept relative to Anchor 1 are then in bed coordinates, and its
 * anchor snapshot keeps its alignment as the bed's offset. Machine positions, anchored offsets
 * and its program do not change. What it does not recognize stays as it is.
 */
export function upgradeBedFrame(plate: JsonObject): JsonObject {
  const setup = isJsonObject(plate.setup) ? plate.setup : null
  const anchors = setup && isJsonObject(setup.anchors) ? setup.anchors : null
  const anchor1 =
    anchors && isXY(anchors.anchor1BedPosition)
      ? anchors.anchor1BedPosition
      : LEGACY_BED_FRAME.anchor1
  const origin =
    anchors &&
    Array.isArray(anchors.anchors) &&
    isJsonObject(anchors.anchors[0])
      ? anchors.anchors[0].id
      : undefined
  const shift = [anchor1[0], anchor1[1], LEGACY_BED_FRAME.z]
  const upgradedSetup = setup && {
    ...setup,
    stockAnchor: shifted(setup.stockAnchor, shift),
    workOrigin: shifted(setup.workOrigin, shift),
    ...(Array.isArray(setup.fixtures) && {
      fixtures: setup.fixtures.map((fixture: unknown) =>
        shiftedFixture(fixture, shift, origin)
      ),
    }),
    ...(Object.hasOwn(setup, "workOriginAnchor") && {
      workOriginAnchor: fromOrigin(setup.workOriginAnchor, origin),
    }),
    ...(Object.hasOwn(setup, "stockRelativeTo") && {
      stockRelativeTo: fromOrigin(setup.stockRelativeTo, origin),
    }),
    ...(Object.hasOwn(setup, "anchors") && {
      anchors: upgradeAnchors(setup.anchors, anchor1),
    }),
  }
  return {
    ...plate,
    ...(upgradedSetup && { setup: upgradedSetup }),
    ...(Array.isArray(plate.operations) && {
      operations: plate.operations.map((operation: unknown) =>
        shiftedOperation(operation, LEGACY_BED_FRAME.z)
      ),
    }),
  }
}

/**
 * A device's fixture profile saved before fixture library version 3, in bed coordinates from
 * Anchor 1 (`upgradeBedFrame`): its fixture definitions' default positions moved by where its
 * anchors put Anchor 1 (the kit's (12, 12) without them) and by the MDF bed's height, its anchors
 * keeping their alignment as the bed's offset. What it does not recognize stays as it is.
 */
export function upgradeProfileBedFrame(profile: unknown): unknown {
  if (!isJsonObject(profile)) return profile
  const anchors = isJsonObject(profile.anchors) ? profile.anchors : null
  const anchor1 =
    anchors && isXY(anchors.anchor1BedPosition)
      ? anchors.anchor1BedPosition
      : LEGACY_BED_FRAME.anchor1
  const shift = [anchor1[0], anchor1[1], LEGACY_BED_FRAME.z]
  return {
    ...profile,
    ...(Object.hasOwn(profile, "anchors") && {
      anchors: upgradeAnchors(profile.anchors, anchor1),
    }),
    ...(Array.isArray(profile.definitions) && {
      definitions: profile.definitions.map((definition: unknown) =>
        isJsonObject(definition)
          ? {
              ...definition,
              defaultPosition: shifted(definition.defaultPosition, shift),
            }
          : definition
      ),
    }),
  }
}
