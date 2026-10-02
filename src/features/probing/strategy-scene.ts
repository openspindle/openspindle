import { machineProgram } from "@/app/workspace/machine-program"
import { compilePlate } from "@/domain/compile/compile"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { GCodeSegment, Point3 } from "@/domain/nc/gcode"
import type { Operation, ProbingSource } from "@/domain/operations/operation"
import { createPlate, createPlateSetup } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import { newProbingOperation } from "@/domain/probing/strategies"
import type { ProbingStrategy } from "@/domain/probing/strategy"
import { bindTools } from "@/domain/tools/tool-table"
import type { Tool } from "@/domain/tools/tool"

/** A solid of a strategy's scene, in its work coordinates, mm. */
export type ScenePart =
  | { readonly kind: "box"; readonly min: Point3; readonly max: Point3 }
  /** A box with a round hole down from its top, to `floor`. */
  | {
      readonly kind: "bore"
      readonly min: Point3
      readonly max: Point3
      readonly center: readonly [number, number]
      readonly radius: number
      readonly floor: number
    }
  | {
      readonly kind: "cylinder"
      readonly center: readonly [number, number]
      readonly radius: number
      readonly bottom: number
      readonly top: number
    }

/** Where the probe touches a surface, and the way that surface faces, towards the probe. */
export type SceneTouch = { readonly point: Point3; readonly normal: Point3 }

/** One move of the probe, and whether it searches for a touch or travels fast. */
export type SceneMove = {
  readonly start: Point3
  readonly end: Point3
  readonly probing: boolean
  readonly rapid: boolean
}

/**
 * What a strategy's picture shows: the moves its machine's firmware makes for it on a sample
 * plate, from where the probe starts, where they touch, the probe's tip and what it probes, all
 * in the sample's work coordinates.
 */
export type StrategyScene = {
  readonly moves: readonly SceneMove[]
  readonly touches: readonly SceneTouch[]
  /** Where the probe's tip is as it starts. */
  readonly tip: Point3
  /** The probe's tip radius, mm. */
  readonly ball: number
  readonly parts: readonly ScenePart[]
}

/** The sample's stock: a block whose top front-left corner is the work origin. */
const STOCK = { width: 40, depth: 30, height: 10 } as const

/** How high above the probed top the picture shows moves at most, mm: travel above is cut. */
const SHOWN_ABOVE = 12

/** How deep below the top an inside corner's step, a pocket and around a boss go, mm. */
const WALL = 6

/** How far in from the stock's edges the sample's height map probes, mm: on an edge it falls off. */
const GRID_INSET = 2

/** Where each strategy's probe starts, in work X and Y and above (or below) the stock top. */
const STARTS: Readonly<Record<ProbingStrategy["id"], Point3>> = {
  "outside-corner": [5, 5, 3],
  "inside-corner": [5, 5, 3],
  "pocket-center": [12, 12, -3],
  "boss-center": [12, 12, 3],
  "touch-off": [12, 10, 5],
  "height-map": [GRID_INSET, GRID_INSET, 2],
  "outline-trace": [0, 0, 3],
}

/** A plate with the sample stock and its machine's factory anchors, with nothing on it yet. */
function samplePlate(kit: FixtureKit): Plate {
  const setup = createPlateSetup({
    stock: {
      id: "strategy-sample",
      name: "Sample",
      material: "Unspecified",
      ...STOCK,
      color: "#a9b3c0",
    },
    stockSource: "assigned",
  })
  return createPlate({ ...setup, anchors: kit.factoryAnchors(null) })
}

/** The strategy's operation on the plate, starting over the probed feature at its height. */
function sampleOperation(
  plate: Plate,
  tool: Tool,
  strategy: ProbingStrategy,
  kit: FixtureKit
): Operation & { readonly source: ProbingSource } {
  const { operation } = newProbingOperation(plate, tool, strategy, kit.probing!)
  const source = operation.source as ProbingSource
  const anchor = plate.setup.anchors?.anchors[0]
  if (!anchor || !("placement" in source.params))
    return { ...operation, source }
  const [x, y, z] = STARTS[strategy.id]
  const [ox, oy, oz] = plate.setup.workOrigin
  const params = {
    ...source.params,
    ...("size" in source.params && {
      size: [STOCK.width - 2 * GRID_INSET, STOCK.depth - 2 * GRID_INSET],
    }),
    placement: {
      kind: "anchor",
      anchorId: anchor.id,
      offset: [ox + x, oy + y],
      height: oz + z,
    },
  }
  return { ...operation, source: { ...source, params } as ProbingSource }
}

const distance = (a: Point3, b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1])

/** A move as the picture shows it: its ends cut to `ceiling`. */
const shown = (
  { start, end, probing, rapid }: GCodeSegment,
  ceiling: number
): SceneMove => ({
  start: [start[0], start[1], Math.min(start[2], ceiling)],
  end: [end[0], end[1], Math.min(end[2], ceiling)],
  probing: !!probing,
  rapid,
})

/**
 * What a strategy probes, from where its touches land: the sample's stock, with the walls of an
 * inside corner, the bore of a pocket or a boss where the side touches meet them. The firmware
 * touches where a routine expects the feature to be, so the feature is drawn there.
 */
function sceneParts(
  strategy: ProbingStrategy,
  stock: { readonly min: Point3; readonly max: Point3 },
  sides: readonly { contact: Point3; direction: readonly [number, number] }[],
  start: Point3,
  ball: number
): ScenePart[] {
  const top = stock.max[2]
  const block: ScenePart = { kind: "box", ...stock }
  switch (strategy.id) {
    case "inside-corner": {
      // The top it starts on is the step's, which it touches first; the corner is where the
      // step goes down beyond it, which it probes back towards.
      const wall = (index: 0 | 1) => {
        const side = sides.find(({ direction }) => direction[index] !== 0)
        return side ? side.contact[index] + side.direction[index] * ball : 0
      }
      const [x, y] = [wall(0), wall(1)]
      const floor = top - WALL
      return [
        {
          kind: "box",
          min: stock.min,
          max: [stock.max[0], stock.max[1], floor],
        },
        {
          kind: "box",
          min: [stock.min[0], stock.min[1], floor],
          max: [x, stock.max[1], top],
        },
        {
          kind: "box",
          min: [x, stock.min[1], floor],
          max: [stock.max[0], y, top],
        },
      ]
    }
    case "pocket-center":
    case "boss-center": {
      const reach = sides.length
        ? Math.max(...sides.map(({ contact }) => distance(contact, start)))
        : 5
      const pocket = strategy.id === "pocket-center"
      const radius = pocket ? reach + ball : reach - ball
      const center = [start[0], start[1]] as const
      if (pocket)
        return [
          {
            kind: "bore",
            ...stock,
            center,
            radius,
            floor: top - WALL,
          },
        ]
      return [
        {
          kind: "box",
          min: stock.min,
          max: [...stock.max.slice(0, 2), top - WALL] as Point3,
        },
        { kind: "cylinder", center, radius, bottom: top - WALL, top },
      ]
    }
    default:
      return [block]
  }
}

/**
 * A strategy's scene on its kit's machine, probing with `tool`: the operation it adds on a sample
 * plate, compiled and followed through the machine's firmware (the preview's own moves), from
 * where its routine starts. Null where the kit has no probing or the operation does not compile.
 */
export function strategyScene(
  strategy: ProbingStrategy,
  tool: Tool,
  kit: FixtureKit,
  library: readonly Tool[]
): StrategyScene | null {
  if (!kit.probing) return null
  const empty = samplePlate(kit)
  const operation = sampleOperation(empty, tool, strategy, kit)
  const bound = bindTools(
    { ...empty, operations: [operation] },
    operation,
    [operation.source.probe],
    { preferred: new Map([[operation.source.probe, tool.id]]), library }
  )
  const plate: Plate = { ...bound.plate, operations: [bound.operation] }
  const compiled = compilePlate(plate, library)
  if (compiled.diagnostics.some(({ severity }) => severity === "error"))
    return null
  const { lines } = compiled.program
  // A plate of one operation emits it as it is: all its lines are the operation's.
  const span = compiled.spans.at(0) ?? { startLine: 1, endLine: lines.length }
  const changes = new Set(
    lines.flatMap((text, index) =>
      /^\s*(?:N\d+\s*)?(?:T\d+\s*)?M0*6(?!\d)/i.test(text) ? [index + 1] : []
    )
  )
  // From where its routine starts: past the tool change and the travel to the start.
  const moves = machineProgram(plate, compiled.program).segments.filter(
    (segment) =>
      segment.line >= span.startLine &&
      segment.line <= span.endLine &&
      !changes.has(segment.line) &&
      !(segment.machine && segment.rapid)
  )
  const first = moves.at(0)
  if (!first) return null
  const [ox, oy, oz] = plate.setup.workOrigin
  const anchor = plate.setup.stockAnchor
  const stock = {
    min: [anchor[0] - ox, anchor[1] - oy, anchor[2] - oz] as Point3,
    max: [
      anchor[0] + STOCK.width - ox,
      anchor[1] + STOCK.depth - oy,
      anchor[2] + STOCK.height - oz,
    ] as Point3,
  }
  const ceiling = stock.max[2] + SHOWN_ABOVE
  const ball = (tool.diameter ?? 2) / 2
  const touches: SceneTouch[] = []
  const sides: { contact: Point3; direction: readonly [number, number] }[] = []
  const touched = (point: Point3, normal: Point3) => {
    const again = touches.some(
      (touch) =>
        distance(touch.point, point) < 0.05 &&
        Math.abs(touch.point[2] - point[2]) < 0.05
    )
    if (!again) touches.push({ point, normal })
  }
  for (const { start, end, probing } of moves) {
    if (!probing) continue
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const length = Math.hypot(dx, dy)
    if (length <= 0.01) {
      // Down onto a top: where the tip meets it.
      touched(end, [0, 0, 1])
      continue
    }
    const direction = [dx / length, dy / length] as const
    sides.push({ contact: end, direction })
    // Against a side: where the ball meets it, level with the ball's centre.
    touched(
      [
        end[0] + direction[0] * ball,
        end[1] + direction[1] * ball,
        end[2] + ball,
      ],
      [-direction[0], -direction[1], 0]
    )
  }
  const start = shown(first, ceiling).start
  return {
    moves: moves.map((move) => shown(move, ceiling)),
    touches,
    tip: start,
    ball,
    parts: sceneParts(strategy, stock, sides, first.start, ball),
  }
}
