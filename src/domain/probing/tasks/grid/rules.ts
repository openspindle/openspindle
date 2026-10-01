import { machineToBed } from "@/domain/anchors/stored-anchors"
import { operationSubject } from "@/domain/diagnostics"
import type { Area } from "@/domain/diagnostics"
import type { Point3 } from "@/domain/nc/gcode"
import type { Stock } from "@/domain/stock/stock"
import { EPSILON, formatMillimetres } from "../../../geometry/millimetres"
import { boxRect, contains, rectAt } from "../../../geometry/rect"
import type { OperationRuleSubject, StageRule } from "../../../rules/stages"
import { checkGridParams, gridStart } from "./plan"
import type { GridParams } from "./params"
import { placementContext } from "../../placement"
import type { PlacementContext, ProbeStart } from "../../placement"
import { editOperation } from "../../rules"
import { strategySpecs } from "../../strategies"

/** The plate a grid operation belongs to. `Plate` satisfies it. */
export type GridPlateContext = PlacementContext & {
  stock: Pick<Stock, "width" | "depth" | "height"> | null
  /** Bed position of the stock's minimum corner. */
  stockAnchor: Point3
}

/**
 * Where an anchored grid is on the bed, at the stock top it probes; null from the probe
 * position, which the plate does not know.
 */
function gridArea(
  params: GridParams,
  plate: GridPlateContext,
  top: number,
  start: ProbeStart | null
): Area | null {
  if (start?.kind !== "anchor" || !plate.anchorSetup) return null
  // Machine XY reaches the bed through the snapshot's registration, as the viewer places it.
  const [x, y] = machineToBed(plate.anchorSetup)(start.machine)
  return {
    kind: "area",
    min: [x, y, top],
    max: [x + params.size[0], y + params.size[1], top],
  }
}

/**
 * A grid operation's grid as its advice reads it: its parameters, its plate, and where the grid
 * starts (null where that does not resolve, which the compiler reports). Null for another
 * operation, a strategy the plate's machine does not have, or parameters that do not parse
 * within its ranges (the compiler reports those too).
 */
function gridAdvice({ operation, plate, kit }: OperationRuleSubject): {
  readonly params: GridParams
  readonly plate: GridPlateContext
  readonly start: ProbeStart | null
} | null {
  const { source } = operation
  if (source.kind !== "probing" || source.task !== "grid") return null
  const specs = strategySpecs(source, kit.probing)
  if (!specs) return null
  const checked = checkGridParams(source.params, specs)
  if (!checked.ok) return null
  const context: GridPlateContext = {
    ...placementContext(plate),
    stock: plate.setup.stock,
    stockAnchor: plate.setup.stockAnchor,
  }
  const resolved = gridStart(checked.params, context)
  return {
    params: checked.params,
    plate: context,
    start: resolved.ok ? resolved.start : null,
  }
}

/**
 * A grid against the plate's stock, with where the grid is on the bed at the stock top (null
 * from the probe position); null without stock.
 */
function gridOnStock(subject: OperationRuleSubject) {
  const advice = gridAdvice(subject)
  const stock = advice?.plate.stock
  if (!advice || !stock) return null
  const { params, plate, start } = advice
  const top = plate.stockAnchor[2] + stock.height
  return {
    params,
    stock,
    stockAnchor: plate.stockAnchor,
    grid: gridArea(params, plate, top, start),
  }
}

const exceedsStock = (
  { size: [width, depth] }: Pick<GridParams, "size">,
  stock: Pick<Stock, "width" | "depth">
) => width > stock.width + EPSILON || depth > stock.depth + EPSILON

/** Where a failing grid is on the bed, when the plate knows. */
const gridPlaces = (grid: Area | null | undefined) =>
  grid ? { places: [grid] } : {}

/** A grid's checks against the stock: without stock, or larger than it, the later ones do not apply. */
const AUTO_LEVEL_STOCK_CHAIN = "grid/stock"

const autoLevelFactoryAnchors: StageRule<"operation"> = {
  id: "grid/factory-anchors",
  stage: "operation",
  label: "Probe grid anchors read",
  description:
    "A grid placed from the machine's factory default anchor positions lands wherever the device's own anchors differ from them.",
  severity: "warning",
  configurable: false,
  test: (subject) => {
    const start = gridAdvice(subject)?.start
    return start?.kind !== "anchor" || start.source !== "factory"
  },
  explain: ({ first }) => ({
    problem:
      "The anchor positions are factory defaults. Use Read anchors to verify them against the device before Run.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

const autoLevelStockUnspecified: StageRule<"operation"> = {
  id: "grid/stock-unspecified",
  stage: "operation",
  label: "Probe grid stock size",
  description: "A grid is checked against the stock, which needs its size.",
  severity: "warning",
  configurable: false,
  chain: AUTO_LEVEL_STOCK_CHAIN,
  test: (subject) => {
    const advice = gridAdvice(subject)
    return !advice || advice.plate.stock !== null
  },
  explain: ({ first }) => ({
    problem:
      "The stock size is unspecified, so the probe grid cannot be checked against it.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

const gridExceedsStock: StageRule<"operation"> = {
  id: "grid/exceeds-stock",
  stage: "operation",
  label: "Probe grid within the stock size",
  description:
    "A grid larger than the stock probes beside it, where there is nothing to measure.",
  severity: "error",
  configurable: false,
  chain: AUTO_LEVEL_STOCK_CHAIN,
  test: (subject) => {
    const fit = gridOnStock(subject)
    return !fit || !exceedsStock(fit.params, fit.stock)
  },
  explain: ({ first }) => {
    const fit = gridOnStock(first)
    return {
      problem: fit
        ? `The ${formatMillimetres(fit.params.size[0])} × ${formatMillimetres(fit.params.size[1])} mm probe grid is larger than the ${formatMillimetres(fit.stock.width)} × ${formatMillimetres(fit.stock.depth)} mm stock.`
        : "The probe grid is larger than the stock.",
      about: operationSubject(first.operation.id),
      ...gridPlaces(fit?.grid),
    }
  },
  fixes: editOperation,
}

const gridOutsideStock: StageRule<"operation"> = {
  id: "grid/outside-stock",
  stage: "operation",
  label: "Probe grid on the stock",
  description:
    "An anchored grid that extends beyond the stock as placed on the bed probes beside it.",
  severity: "warning",
  configurable: false,
  chain: AUTO_LEVEL_STOCK_CHAIN,
  test: (subject) => {
    const fit = gridOnStock(subject)
    const grid = fit?.grid
    if (!fit || !grid) return true
    const [stockX, stockY] = fit.stockAnchor
    return contains(
      rectAt([stockX, stockY], [fit.stock.width, fit.stock.depth]),
      boxRect(grid)
    )
  },
  explain: ({ first }) => ({
    problem:
      "The anchored probe grid extends beyond the stock as placed on the bed.",
    about: operationSubject(first.operation.id),
    ...gridPlaces(gridOnStock(first)?.grid),
  }),
  fixes: editOperation,
}

/** The advice for a grid operation: its anchors, and its grid against the stock. */
export const GRID_RULES: readonly StageRule<"operation">[] = [
  autoLevelFactoryAnchors,
  autoLevelStockUnspecified,
  gridExceedsStock,
  gridOutsideStock,
]
