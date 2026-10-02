import { fixtureBounds } from "../fixtures/definitions"
import type { MountFeature } from "../fixtures/mount-points"
import { fixtureSolids } from "../fixtures/solids"
import type { Vec2 } from "../geometry/frame"
import { EPSILON, roundMillimetres } from "../geometry/millimetres"
import type { Point3 } from "../primitives"
import type { StrategyId } from "../probing/strategy"
import {
  PROBE_3D_CORNERS,
  PROBE_3D_CORNER_LABELS,
  cornerInward,
} from "../probing/tasks/origin/params"
import type { Probe3dCorner } from "../probing/tasks/origin/params"
import { ownMountPoints, setupItems } from "./setup-items"
import type { SetupItem, SetupItemRef, SetupSubject } from "./setup-items"

/**
 * What a pick snaps to: an outside corner of an item's top, an inside corner where two walls
 * meet, a hole or slot to centre in, or a centre (of a top, or of a pin) to centre on.
 */
export type PickTargetKind =
  "outside-corner" | "inside-corner" | "hole" | "center"

/** A point a probing start can be picked on, in bed millimetres. */
export type PickTarget = {
  /** Unique on the plate. */
  readonly key: string
  readonly label: string
  readonly kind: PickTargetKind
  /** X and Y from the bed's origin (Anchor 1 on the Z1), Z on the top of what it is on. */
  readonly position: Point3
  /** Which corner a corner is, as its strategy's `corner` parameter names it. */
  readonly corner?: Probe3dCorner
  /**
   * The item it is on (an inside corner's higher wall's), as setup points refer to theirs: a view
   * leaves out a hidden fixture's targets by it.
   */
  readonly item?: SetupItemRef
}

/** An item that targets are on, as setup items name it. */
type Owner = Pick<SetupItem, "ref" | "key" | "name">

/** A solid box's footprint on the bed and its top, and the item it is part of. */
type Block = {
  readonly owner: Owner
  readonly min: Vec2
  readonly max: Vec2
  readonly top: number
  /** Whether it is a pin (centred on one of its item's pins), which is round: it has no corners. */
  readonly round: boolean
}

/** The highest block over a spot, and its top; nothing there is lower than anything. */
type Level = { readonly top: number; readonly block: Block | null }

/** Bed coordinates to the nanometre, without −0. */
const onBed = (value: number) => roundMillimetres(value) + 0

/** A top a probe touches off on is at least this wide and deep, mm. */
const MIN_TOP = 5

/** How far into a quadrant a ray is cast beside the point it starts at, mm. */
const BESIDE = 1e-3

/**
 * The boxes the plate's walls are made of: the stock's, and each enabled fixture's solids
 * (`fixtureSolids`) but for its bed's, which carries the stock.
 */
function setupBlocks(
  subject: SetupSubject,
  items: readonly SetupItem[]
): Block[] {
  const fixtures = subject.fixtures ?? []
  const block = (
    owner: Owner,
    min: readonly number[],
    max: readonly number[],
    top: number,
    pins: readonly Point3[] = []
  ): Block => {
    const footprint = {
      min: [onBed(min[0]), onBed(min[1])] as const,
      max: [onBed(max[0]), onBed(max[1])] as const,
    }
    const [x, y] = [0, 1].map(
      (axis) => (footprint.min[axis] + footprint.max[axis]) / 2
    )
    const round = pins.some(
      (pin) =>
        Math.abs(pin[0] - x) <= EPSILON && Math.abs(pin[1] - y) <= EPSILON
    )
    return { owner, ...footprint, top: onBed(top), round }
  }
  return items.flatMap((item): Block[] => {
    const { ref } = item
    if (ref.kind === "stock") {
      const { stock, stockAnchor } = subject
      if (!stock) return []
      const [x, y, bottom] = stockAnchor
      return [
        block(
          item,
          [x, y],
          [x + stock.width, y + stock.depth],
          bottom + stock.height
        ),
      ]
    }
    if (ref.kind !== "fixture") return []
    const instance = fixtures.find((each) => each.id === ref.id)
    if (!instance) return []
    const pins = ownMountPoints(subject, ref, null).flatMap((point) =>
      point.feature === "pin" ? [point.position] : []
    )
    return fixtureSolids([instance]).map((solid) =>
      block(item, solid.min, solid.max, solid.max[2], pins)
    )
  })
}

/** The four quadrants about a point, by the directions they lie in, each turn a quarter on. */
const QUADRANTS: readonly Vec2[] = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
]

/** Whether a span covers the side `side` of `at`, just beside it. */
const spansBeside = (low: number, high: number, at: number, side: number) =>
  side > 0
    ? low <= at + EPSILON && at < high - EPSILON
    : low + EPSILON < at && at <= high + EPSILON

/** The highest block over a quadrant just beside a point; nothing there is lower than anything. */
function levelBeside(
  blocks: readonly Block[],
  [x, y]: Vec2,
  [sx, sy]: Vec2
): Level {
  let level: Level = { top: -Infinity, block: null }
  for (const block of blocks)
    if (
      block.top > level.top &&
      spansBeside(block.min[0], block.max[0], x, sx) &&
      spansBeside(block.min[1], block.max[1], y, sy)
    )
      level = { top: block.top, block }
  return level
}

/** Whether a block stands over a point higher than `z`: its footprint holds it, edges included. */
const standsOver = (block: Block, [x, y]: readonly number[], z: number) =>
  block.top > z + EPSILON &&
  x >= block.min[0] - EPSILON &&
  x <= block.max[0] + EPSILON &&
  y >= block.min[1] - EPSILON &&
  y <= block.max[1] + EPSILON

/**
 * Where corners can be: the corners of every block, and where a side of one crosses a side of
 * another.
 */
function cornerCandidates(blocks: readonly Block[]): Vec2[] {
  const points = new Map<string, Vec2>()
  const add = (x: number, y: number) => points.set(`${x},${y}`, [x, y])
  const within = (value: number, low: number, high: number) =>
    value >= low - EPSILON && value <= high + EPSILON
  for (const a of blocks)
    for (const x of [a.min[0], a.max[0]]) {
      for (const y of [a.min[1], a.max[1]]) add(x, y)
      for (const b of blocks)
        for (const y of [b.min[1], b.max[1]])
          if (within(x, b.min[0], b.max[0]) && within(y, a.min[1], a.max[1]))
            add(x, y)
    }
  return [...points.values()]
}

/** The corner whose stock (outside) or pocket (inside) lies towards `toward` (`cornerInward`). */
function cornerToward([sx, sy]: Vec2): Probe3dCorner {
  const corner = PROBE_3D_CORNERS.find((each) => {
    const [x, y] = cornerInward(each)
    return x === sx && y === sy
  })
  if (!corner) throw new Error("A corner lies towards no quadrant.")
  return corner
}

/**
 * Whether an item's walls close a pocket in on every side from one of its corners, as round
 * ended slots and holes modelled as boxes do: the item is solid above the pocket further on in X
 * and in Y. Its corners are not corners a probe finds.
 */
function enclosedBy(
  blocks: readonly Block[],
  owner: Owner,
  [x, y]: Vec2,
  [sx, sy]: Vec2,
  floor: number
): boolean {
  const walls = blocks.filter(
    (block) => block.owner.key === owner.key && block.top > floor + EPSILON
  )
  const ahead = (low: number, high: number, at: number, side: number) =>
    side > 0 ? low >= at - EPSILON : high <= at + EPSILON
  const across = (low: number, high: number, at: number) =>
    low < at && at < high
  const inX = walls.some(
    (block) =>
      ahead(block.min[0], block.max[0], x, sx) &&
      across(block.min[1], block.max[1], y + sy * BESIDE)
  )
  const inY = walls.some(
    (block) =>
      ahead(block.min[1], block.max[1], y, sy) &&
      across(block.min[0], block.max[0], x + sx * BESIDE)
  )
  return inX && inY
}

type Corner = {
  readonly kind: "outside-corner" | "inside-corner"
  readonly corner: Probe3dCorner
  readonly position: Point3
  readonly owner: Owner
  /** An inside corner's lower wall's item, where it is another item's. */
  readonly other: Owner | null
}

const cornerName = (corner: Probe3dCorner) =>
  PROBE_3D_CORNER_LABELS[corner].toLowerCase()

/**
 * The corners of the plate's walls: where, of the four quadrants about a point, one is higher
 * than the rest (an outside corner of what is there, on its top), or one is lower than the rest
 * (an inside corner, the pocket that one, on the higher wall's top). A corner in or under a
 * higher solid is none; nor are a pin's, which is round, or those of a pocket that one item
 * closes in on every side.
 */
function wallCorners(blocks: readonly Block[]): Corner[] {
  const corners: Corner[] = []
  for (const point of cornerCandidates(blocks)) {
    const levels = QUADRANTS.map((quadrant) =>
      levelBeside(blocks, point, quadrant)
    )
    const tops = levels.map((level) => level.top)
    const highest = Math.max(...tops)
    const lowest = Math.min(...tops)
    const at = (top: number) =>
      tops.flatMap((each, index) =>
        Math.abs(each - top) <= EPSILON || each === top ? [index] : []
      )
    const [high, ...higher] = at(highest)
    const [low, ...lower] = at(lowest)
    const top = levels[high].block
    if (higher.length === 0 && top && !top.round)
      corners.push({
        kind: "outside-corner",
        corner: cornerToward(QUADRANTS[high]),
        position: [point[0], point[1], highest],
        owner: top.owner,
        other: null,
      })
    if (lower.length > 0 || highest === lowest) continue
    const [first, second] = [levels[(low + 1) % 4], levels[(low + 3) % 4]]
    const [wall, otherWall] =
      first.top >= second.top
        ? [first.block, second.block]
        : [second.block, first.block]
    if (!wall || !otherWall || wall.round || otherWall.round) continue
    const toward = QUADRANTS[low]
    const same = wall.owner.key === otherWall.owner.key
    if (same && enclosedBy(blocks, wall.owner, point, toward, lowest)) continue
    corners.push({
      kind: "inside-corner",
      corner: cornerToward(toward),
      position: [point[0], point[1], wall.top],
      owner: wall.owner,
      other: same ? null : otherWall.owner,
    })
  }
  return corners
}

/**
 * Corners as targets: "Stock · back-right corner"; an item's one inside corner of its own as
 * "L-bracket · thick · inner corner", its several by their corners, and one with another item
 * as "L-bracket · thick · front-left inner corner with Stock".
 */
function cornerTargets(corners: readonly Corner[]): PickTarget[] {
  const ownInner = (owner: Owner) =>
    corners.filter(
      (each) =>
        each.kind === "inside-corner" &&
        each.other === null &&
        each.owner.key === owner.key
    ).length
  return corners.map(({ kind, corner, position, owner, other }) => {
    const [x, y] = position
    const name = cornerName(corner)
    let what = `${name} corner`
    if (kind === "inside-corner" && other)
      what = `${name} inner corner with ${other.name}`
    else if (kind === "inside-corner")
      what = ownInner(owner) > 1 ? `${name} inner corner` : "inner corner"
    return {
      key: `${owner.key}/${kind}/${x},${y}`,
      label: `${owner.name} · ${what}`,
      kind,
      position,
      corner,
      item: owner.ref,
    }
  })
}

/**
 * The top of an item that its points are on: a fixture's highest, a bed's where its points
 * are.
 */
function itemTop(
  subject: SetupSubject,
  ref: SetupItemRef,
  point: Point3
): number {
  if (ref.kind !== "fixture") return point[2]
  const instance = subject.fixtures?.find((each) => each.id === ref.id)
  const box = instance ? fixtureBounds(instance) : null
  return box ? box.max[2] : point[2]
}

/**
 * The mount points of the bed and the fixtures that are `features` (`MountPoint.feature`), on
 * their items' tops, but those another item stands over higher. Of points at one place, the
 * highest: a fixture's hole over the bed's.
 */
function featureTargets(
  subject: SetupSubject,
  items: readonly SetupItem[],
  blocks: readonly Block[],
  features: readonly MountFeature[],
  kind: PickTargetKind
): PickTarget[] {
  const targets = items.flatMap((item): PickTarget[] => {
    if (item.ref.kind !== "bed" && item.ref.kind !== "fixture") return []
    return ownMountPoints(subject, item.ref, null).flatMap((point) => {
      if (!point.feature || !features.includes(point.feature)) return []
      const [x, y] = point.position
      const position: Point3 = [
        onBed(x),
        onBed(y),
        onBed(itemTop(subject, item.ref, point.position)),
      ]
      const covered = blocks.some(
        (block) =>
          block.owner.key !== item.key &&
          standsOver(block, position, position[2])
      )
      if (covered) return []
      return [
        {
          key: `${item.key}/${point.id}`,
          label: `${item.name} · ${point.name}`,
          kind,
          position,
          item: item.ref,
        },
      ]
    })
  })
  const samePlace = (a: Point3, b: Point3) =>
    Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON
  return targets.filter(
    (target) =>
      !targets.some(
        (other) =>
          other.position[2] > target.position[2] + EPSILON &&
          samePlace(other.position, target.position)
      )
  )
}

/** The stock's top centre, unless something stands over it higher. */
function stockCenter(
  subject: SetupSubject,
  items: readonly SetupItem[],
  blocks: readonly Block[]
): PickTarget[] {
  const item = items.find((each) => each.ref.kind === "stock")
  if (!item) return []
  const point = ownMountPoints(subject, item.ref, null).find(
    (each) => each.id === "top-center"
  )
  if (!point) return []
  const position = point.position.map(onBed) as Point3
  if (blocks.some((block) => standsOver(block, position, position[2])))
    return []
  return [
    {
      key: `${item.key}/${point.id}`,
      label: `${item.name} · top center`,
      kind: "center",
      position,
      item: item.ref,
    },
  ]
}

/**
 * The middles of the fixtures' tops a probe can touch off on: of each of their solids at least
 * `MIN_TOP` across, where nothing stands over it higher.
 */
function fixtureTopCenters(blocks: readonly Block[]): PickTarget[] {
  const fixtures = blocks.filter((block) => block.owner.ref.kind === "fixture")
  const owners = new Map<string, Block[]>()
  for (const block of fixtures)
    owners.set(block.owner.key, [...(owners.get(block.owner.key) ?? []), block])
  return [...owners.values()].flatMap((own) => {
    const tops = own.flatMap((block, index) => {
      const wide =
        block.max[0] - block.min[0] >= MIN_TOP &&
        block.max[1] - block.min[1] >= MIN_TOP
      const position: Point3 = [
        onBed((block.min[0] + block.max[0]) / 2),
        onBed((block.min[1] + block.max[1]) / 2),
        block.top,
      ]
      const covered = blocks.some((other) =>
        standsOver(other, position, block.top)
      )
      return wide && !covered ? [{ block, index, position }] : []
    })
    return tops.map(({ block, index, position }, shown): PickTarget => {
      const { owner } = block
      const number = tops.length > 1 ? ` ${shown + 1}` : ""
      return {
        key: `${owner.key}/top-${index + 1}`,
        label: `${owner.name} · top center${number}`,
        kind: "center",
        position,
        item: owner.ref,
      }
    })
  })
}

/**
 * The snap targets a strategy offers on a plate's setup, in bed coordinates, from the stock's
 * box and the enabled fixtures' solids (`fixtureSolids`; a bed carries the stock and is no wall)
 * where they stand together, and from the bed's and fixtures' holes, slots and pins
 * (`MountPoint.feature`):
 *
 * - an outside corner: the outside corners of the tops, each the corner it is;
 * - an inside corner: where two walls meet around a lower pocket, such as an L-bracket's inner
 *   corner or the stock pushed against a fixture, each the corner of its pocket it is;
 * - a pocket's centre: the holes and slots no other item covers;
 * - a boss's centre: the stock's top centre, and the pins;
 * - a touch-off or a height map: the outside corners, and the middles of the stock's and the
 *   fixtures' tops.
 *
 * An outline picks edges, not points: none.
 */
export function pickTargets(
  setup: SetupSubject,
  strategy: StrategyId
): PickTarget[] {
  const items = setupItems(setup)
  const blocks = setupBlocks(setup, items)
  const corners = (kind: Corner["kind"]) =>
    cornerTargets(wallCorners(blocks)).filter((target) => target.kind === kind)
  switch (strategy) {
    case "outside-corner":
      return corners("outside-corner")
    case "inside-corner":
      return corners("inside-corner")
    case "pocket-center":
      return featureTargets(setup, items, blocks, ["hole", "slot"], "hole")
    case "boss-center":
      return [
        ...stockCenter(setup, items, blocks),
        ...featureTargets(setup, items, blocks, ["pin"], "center"),
      ]
    case "touch-off":
    case "height-map":
      return [
        ...corners("outside-corner"),
        ...stockCenter(setup, items, blocks),
        ...fixtureTopCenters(blocks),
      ]
    case "outline-trace":
      return []
  }
}
