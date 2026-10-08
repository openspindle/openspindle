import { stockCuts } from "../compile/stock-depth"
import { operationSubject } from "../diagnostics"
import type { Area } from "../diagnostics"
import { translation } from "../geometry/frame"
import { formatMillimetres } from "../geometry/millimetres"
import { boxRect, contains, mapRect, rectAt } from "../geometry/rect"
import type { Rect } from "../geometry/rect"
import { editOperation } from "../rules/diagnostics"
import type { OperationRuleSubject, StageRule } from "../rules/stages"
import { plotOrigin } from "./plot-origin"

const mm = (value: number) => formatMillimetres(Number(value.toFixed(2)))

/** A rectangle's X and Y ranges, to hundredths: "X -67.4…-1.73, Y -101.47…-74.4". */
const ranges = ({ min, max }: Rect) =>
  `X ${mm(min[0])}…${mm(max[0])}, Y ${mm(min[1])}…${mm(max[1])}`

/**
 * Where a PCB operation's cuts leave the stock as placed: on the bed, and with the stock from the
 * work origin, which stands for the origin KiCad plotted the program from; whether they miss the
 * stock altogether. Null for another operation, without stock or cuts, or with its cuts on the
 * stock.
 */
function boardBeyondStock(subject: OperationRuleSubject): {
  readonly area: Area
  readonly cuts: Rect<"work">
  readonly stock: Rect<"work">
  readonly apart: boolean
} | null {
  if (subject.operation.source.kind !== "pcb") return null
  const placed = stockCuts(subject)
  const { stock, stockAnchor, workOrigin } = subject.plate.setup
  if (!placed || !stock) return null
  const cuts = boxRect<"bed">(placed.area)
  const onBed = rectAt<"bed">(
    [stockAnchor[0], stockAnchor[1]],
    [stock.width, stock.depth]
  )
  if (contains(onBed, cuts)) return null
  const fromOrigin = translation<"bed", "work">([
    -workOrigin[0],
    -workOrigin[1],
  ])
  return {
    area: placed.area,
    cuts: mapRect(cuts, fromOrigin),
    stock: mapRect(onBed, fromOrigin),
    apart:
      cuts.max[0] < onBed.min[0] ||
      cuts.max[1] < onBed.min[1] ||
      cuts.min[0] > onBed.max[0] ||
      cuts.min[1] > onBed.max[1],
  }
}

const boardOnStock: StageRule<"operation"> = {
  id: "pcb/outside-stock",
  stage: "operation",
  label: "PCB on the stock",
  description:
    "A PCB program keeps the origin KiCad plotted it from. Plotted from the page origin rather than a drill/place file origin at the work origin, the board lands beside the stock.",
  severity: "warning",
  configurable: false,
  test: (subject) => !boardBeyondStock(subject),
  explain: ({ first }) => {
    const beyond = boardBeyondStock(first)
    const { name } = first.operation
    return {
      problem: beyond
        ? `${name} ${beyond.apart ? "cuts outside the stock" : "reaches beyond the stock"}: ${ranges(beyond.cuts)} mm from the work origin, where the stock is ${ranges(beyond.stock)}.`
        : `${name} reaches beyond the stock.`,
      advice:
        "In KiCad, put the drill/place file origin where the work origin falls relative to the board (Place › Drill/Place File Origin), plot with Use drill/place file origin and drill files from the same origin, then replace this operation's file.",
      about: operationSubject(first.operation.id),
      places: beyond ? [beyond.area] : [],
    }
  },
  fixes: editOperation,
}

/** How far below the plot origin a coordinate may lie, as rounding leaves it, mm. */
const BELOW_ORIGIN = 0.05

/** How far from the plot origin a board outline may start, mm. */
const OUTLINE_FROM_ORIGIN = 0.5

/**
 * Why a PCB operation's file was not plotted from a drill/place file origin on the board's
 * bottom-left corner: plotted from the page origin; with coordinates left of or below its
 * origin; or, for the board outline, which reaches the board's corner, starting away from it.
 * Null where it was, or the file does not tell.
 */
function plotOriginProblem({ operation }: OperationRuleSubject): string | null {
  if (operation.source.kind !== "pcb") return null
  const { data } = operation.source
  const { pageOrigin, min } = plotOrigin(data)
  if (pageOrigin)
    return "was plotted from KiCad's page origin rather than the drill/place file origin"
  if (!min) return null
  const [x, y] = min
  if (x < -BELOW_ORIGIN || y < -BELOW_ORIGIN)
    return `reaches ${x < -BELOW_ORIGIN ? `X ${mm(x)}` : `Y ${mm(y)}`} mm, left of or below its origin, so its drill/place file origin is not on the board's bottom-left corner`
  if (
    data.file.role === "outline" &&
    (x > OUTLINE_FROM_ORIGIN || y > OUTLINE_FROM_ORIGIN)
  )
    return `starts at X ${mm(x)}, Y ${mm(y)} mm from its origin, so its drill/place file origin is not on the board's bottom-left corner`
  return null
}

const plotOriginBottomLeft: StageRule<"operation"> = {
  id: "pcb/plot-origin",
  stage: "operation",
  label: "PCB plotted from its bottom-left corner",
  description:
    "Gerber and drill files plotted from a drill/place file origin on the board's bottom-left corner machine from that corner, which the work origin then stands for, as the stock's front-left corner.",
  severity: "warning",
  configurable: true,
  test: (subject) => !plotOriginProblem(subject),
  explain: ({ first }) => ({
    problem: `${first.operation.name} ${plotOriginProblem(first) ?? "was not plotted from the board's bottom-left corner"}.`,
    advice:
      "In KiCad, put the drill/place file origin on the board's bottom-left corner (Place › Drill/Place File Origin), plot with Use drill/place file origin and the drill files from the same origin, then replace this operation's file.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

/**
 * PCB operations, whose programs keep KiCad's plot origin: plotted from the board's bottom-left
 * corner, their cuts must land on the stock.
 */
export const PCB_RULES: readonly StageRule<"operation">[] = [
  plotOriginBottomLeft,
  boardOnStock,
]
