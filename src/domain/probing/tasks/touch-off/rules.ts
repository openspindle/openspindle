import { machineToBed } from "@/domain/anchors/stored-anchors"
import { operationSubject } from "@/domain/diagnostics"
import type { Point3 } from "@/domain/nc/gcode"
import { contains, rectAt } from "../../../geometry/rect"
import type { OperationRuleSubject, StageRule } from "../../../rules/stages"
import { planTouchOff } from "./plan"
import {
  laterGrids,
  placementContext,
  touchesGridStarts,
} from "../../placement"
import type { ProbeStart } from "../../placement"
import { editOperation } from "../../rules"
import { strategySpecs } from "../../strategies"

/**
 * A touch-off operation as its advice reads it: where it starts, null where the anchored point
 * does not resolve (the compiler reports why). Null for another operation, a strategy the
 * plate's machine does not have, or parameters that do not parse within its ranges (the
 * compiler reports those too).
 */
function touchOffAdvice({
  operation,
  plate,
  kit,
}: OperationRuleSubject): { readonly start: ProbeStart | null } | null {
  const { source } = operation
  if (source.kind !== "probing" || source.task !== "touch-off") return null
  const specs = strategySpecs(source, kit.probing)
  if (!specs) return null
  const plan = planTouchOff(source.params, placementContext(plate), specs)
  if (plan.ok) return { start: plan.start }
  return plan.issues.some((issue) => issue.code === "invalid-parameters")
    ? null
    : { start: null }
}

/**
 * Where an anchored touch point is on the bed, and whether it is over the stock as placed; null
 * without stock, from the probe position, or without the plate's anchor snapshot.
 */
function touchOnStock(subject: OperationRuleSubject): {
  readonly at: Point3
  readonly onStock: boolean
} | null {
  const start = touchOffAdvice(subject)?.start
  const { stock, stockAnchor, anchors } = subject.plate.setup
  if (!stock || start?.kind !== "anchor" || !anchors) return null
  // Machine XY reaches the bed through the snapshot's registration, as the viewer places it.
  const [x, y] = machineToBed(anchors)(start.machine)
  const [stockX, stockY, stockZ] = stockAnchor
  return {
    // Beside the stock, at the height of what it stands on.
    at: [x, y, stockZ],
    onStock: contains(
      rectAt<"bed">([stockX, stockY], [stock.width, stock.depth]),
      [x, y]
    ),
  }
}

/** The stock checks of a touch point: without stock, it cannot be placed on it. */
const AUTO_Z_HEIGHT_STOCK_CHAIN = "touch-off/stock"

const zHeightFactoryAnchors: StageRule<"operation"> = {
  id: "touch-off/factory-anchors",
  stage: "operation",
  label: "Touch-off anchors read",
  description:
    "A touch point placed from the machine's factory default anchor positions lands wherever the device's own anchors differ from them.",
  severity: "warning",
  configurable: false,
  test: (subject) => {
    const start = touchOffAdvice(subject)?.start
    return start?.kind !== "anchor" || start.source !== "factory"
  },
  explain: ({ first }) => ({
    problem:
      "The anchor positions are factory defaults. Use Read anchors to verify them against the device before Run.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

const zHeightStockUnspecified: StageRule<"operation"> = {
  id: "touch-off/stock-unspecified",
  stage: "operation",
  label: "Touch-off stock size",
  description:
    "A touch point is checked against the stock, which needs its size.",
  severity: "warning",
  configurable: false,
  chain: AUTO_Z_HEIGHT_STOCK_CHAIN,
  test: (subject) =>
    !touchOffAdvice(subject) || subject.plate.setup.stock !== null,
  explain: ({ first }) => ({
    problem:
      "The stock size is unspecified, so the touch point cannot be checked against it.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

const pointOutsideStock: StageRule<"operation"> = {
  id: "touch-off/outside-stock",
  stage: "operation",
  label: "Touch-off point on the stock",
  description:
    "An anchored touch point off the stock sets work Z on another surface.",
  severity: "warning",
  configurable: false,
  chain: AUTO_Z_HEIGHT_STOCK_CHAIN,
  test: (subject) => touchOnStock(subject)?.onStock ?? true,
  explain: ({ first }) => {
    const touch = touchOnStock(first)
    return {
      problem:
        "The anchored probe point is off the stock as placed on the bed, so the probe would set work Z on another surface.",
      about: operationSubject(first.operation.id),
      ...(touch && { places: [{ kind: "point", at: touch.at } as const] }),
    }
  },
  fixes: editOperation,
}

const zHeightBeforeAutoLevel: StageRule<"operation"> = {
  id: "touch-off/before-grid",
  stage: "operation",
  label: "Touch-off after the probe grid",
  description:
    "Work Z set before a probe grid is exact only where the grid starts.",
  severity: "warning",
  configurable: false,
  test: ({ operation, plate, kit }) => {
    const { source } = operation
    return (
      source.kind !== "probing" ||
      source.task !== "touch-off" ||
      !strategySpecs(source, kit.probing) ||
      touchesGridStarts(source.params.placement, laterGrids(plate, operation))
    )
  },
  explain: ({ first }) => ({
    problem:
      "A later probe grid measures heights from its first point, so work Z is off by any height difference between that point and this one. Move it after the probe grid, or probe where the grid starts.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

/** The advice for a touch-off operation: its anchors, its point against the stock, its order. */
export const TOUCH_OFF_RULES: readonly StageRule<"operation">[] = [
  zHeightFactoryAnchors,
  zHeightStockUnspecified,
  pointOutsideStock,
  zHeightBeforeAutoLevel,
]
