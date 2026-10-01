import { z } from "zod"
import { fixturePointOnBed, namedFixtures } from "@/domain/fixtures/definitions"
import { EntityIdSchema } from "@/domain/primitives"
import type { Point3 } from "@/domain/primitives"
import type { PlateSetup } from "./plate"

/** The sides of an item's top, by the item's own front, right, back and left. */
export const EDGE_SIDES = ["front", "right", "back", "left"] as const
export const EdgeSideSchema = z.enum(EDGE_SIDES)
export type EdgeSide = z.infer<typeof EdgeSideSchema>

/** What an edge is of: the plate's stock, or one of its fixtures. */
export const EdgeItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("stock") }),
  z.strictObject({ kind: z.literal("fixture"), id: EntityIdSchema }),
])
export type EdgeItem = z.infer<typeof EdgeItemSchema>

/** One side of an item's top, as an operation keeps it. */
export const ItemEdgeRefSchema = z.strictObject({
  item: EdgeItemSchema,
  side: EdgeSideSchema,
})
export type ItemEdgeRef = z.infer<typeof ItemEdgeRefSchema>

/** A side of an item's top on the bed, from `start` to `end`, and what it is called. */
export type ItemEdge = {
  readonly ref: ItemEdgeRef
  readonly label: string
  readonly start: Point3
  readonly end: Point3
}

/** An edge's identity: its item and side. */
export const edgeKey = ({ item, side }: ItemEdgeRef) =>
  `${item.kind === "fixture" ? `fixture:${item.id}` : "stock"}/${side}`

export const sameEdge = (a: ItemEdgeRef, b: ItemEdgeRef) =>
  edgeKey(a) === edgeKey(b)

/** Front, right, back and left of a top whose corners run front-left, front-right, back-right, back-left. */
function sides(
  item: EdgeItem,
  name: string,
  [frontLeft, frontRight, backRight, backLeft]: readonly Point3[]
): ItemEdge[] {
  const edge = (side: EdgeSide, start: Point3, end: Point3): ItemEdge => ({
    ref: { item, side },
    label: `${name} · ${side}`,
    start,
    end,
  })
  return [
    edge("front", frontLeft, frontRight),
    edge("right", frontRight, backRight),
    edge("back", backRight, backLeft),
    edge("left", backLeft, frontLeft),
  ]
}

/** Whether a turn leaves a fixture's top on top: about Z only. */
const liesFlat = ([x, y]: readonly number[]) => x % 360 === 0 && y % 360 === 0

/**
 * The edges of the plate's stock's top and of each fixture on its bed with a model that lies
 * flat (turned about Z only): the stock's box, a fixture's model bounds at its position and turn,
 * so a turned fixture's sides are its own. Fixtures are named as the Fixtures panel lists them.
 */
export function itemEdges(
  setup: Pick<PlateSetup, "stock" | "stockAnchor" | "fixtures">
): ItemEdge[] {
  const edges: ItemEdge[] = []
  const { stock, stockAnchor } = setup
  if (stock) {
    const [x, y, bottom] = stockAnchor
    const top = bottom + stock.height
    edges.push(
      ...sides({ kind: "stock" }, "Stock", [
        [x, y, top],
        [x + stock.width, y, top],
        [x + stock.width, y + stock.depth, top],
        [x, y + stock.depth, top],
      ])
    )
  }
  const placed = setup.fixtures.filter((instance) => instance.enabled)
  for (const { instance, name } of namedFixtures(placed)) {
    const { model } = instance.definition
    if (!model || !liesFlat(instance.rotation)) continue
    const { min, max } = model.bounds
    const corner = (x: number, y: number) =>
      fixturePointOnBed(instance, [x, y, max[2]])
    edges.push(
      ...sides({ kind: "fixture", id: instance.id }, name, [
        corner(min[0], min[1]),
        corner(max[0], min[1]),
        corner(max[0], max[1]),
        corner(min[0], max[1]),
      ])
    )
  }
  return edges
}
