import { machineToBed } from "../../../anchors/stored-anchors"
import { operationSubject } from "../../../diagnostics"
import { fixtureSolids, standsUnder } from "../../../fixtures/solids"
import type { Solid } from "../../../fixtures/solids"
import { EPSILON, formatMillimetres } from "../../../geometry/millimetres"
import type { Point3 } from "../../../primitives"
import type { OperationRuleSubject, StageRule } from "../../../rules/stages"
import { setsWorkZ } from "./params"
import { planOrigin } from "./plan"
import {
  laterGrids,
  placementContext,
  placementHeight,
  touchesGridStarts,
} from "../../placement"
import type { ProbeStart } from "../../placement"
import { editOperation } from "../../rules"
import { methodSpecs } from "../../strategies"

/**
 * A 3D probing operation's start as its advice reads it; null for another operation, a strategy
 * the plate's machine does not support, or parameters or an anchored start that do not resolve
 * (the compiler reports those).
 */
function probingStart({
  operation,
  plate,
  kit,
}: OperationRuleSubject): ProbeStart | null {
  const { source } = operation
  if (source.kind !== "probing" || source.task !== "origin") return null
  const specs = methodSpecs(source, kit.probing, plate)
  if (!specs) return null
  const plan = planOrigin(source.params, placementContext(plate), specs)
  return plan.ok ? plan.start : null
}

const probe3dFactoryAnchors: StageRule<"operation"> = {
  id: "origin/factory-anchors",
  stage: "operation",
  label: "3D probing anchors read",
  description:
    "A start placed from the machine's factory default anchor positions lands wherever the device's own anchors differ from them.",
  severity: "warning",
  configurable: false,
  test: (subject) => {
    const start = probingStart(subject)
    return start?.kind !== "anchor" || start.source !== "factory"
  },
  explain: ({ first }) => ({
    problem:
      "The anchor positions are factory defaults. Use Read anchors to verify them against the device before Run.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

/**
 * A routine that sets work Z does so as a touch-off does, from the position without height
 * compensation, while a later probe grid measures heights from its first point: work Z is exact
 * after the grid, and before it only where the grid starts. A grid from the probe
 * position does not start there even right after it, as the routine leaves the probe over what
 * it found rather than over the top it touched.
 */
const probe3dBeforeAutoLevel: StageRule<"operation"> = {
  id: "origin/before-grid",
  stage: "operation",
  label: "3D probing after the probe grid",
  description:
    "Work Z set by 3D probing before a probe grid is exact only where the grid starts.",
  severity: "warning",
  configurable: false,
  test: ({ operation, plate, kit }) => {
    const { source } = operation
    if (
      source.kind !== "probing" ||
      source.task !== "origin" ||
      !methodSpecs(source, kit.probing, plate)
    )
      return true
    const { routine, placement } = source.params
    const moved = laterGrids(plate, operation).map((grid) => ({
      ...grid,
      adjacent: false,
    }))
    return !setsWorkZ(routine) || touchesGridStarts(placement, moved)
  },
  explain: ({ first }) => ({
    problem:
      "A later probe grid measures heights from its first point, so work Z is off by any height difference between that point and the top this probing touches. Move it after the probe grid, or probe where the grid starts.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

/**
 * Where an anchored start with a height is on the bed, and the tallest of the stock and the
 * fixtures standing there (`fixtureSolids`) whose top is above that height, which the probe comes
 * down into; null without one, for a start without a height or from the probe position, and for
 * a pocket's centring, which starts in the pocket it centres, below the top around it.
 */
function startBelowTop(subject: OperationRuleSubject): {
  readonly at: Point3
  readonly solid: Solid
} | null {
  const { source } = subject.operation
  if (source.kind !== "probing" || source.task !== "origin") return null
  const height = placementHeight(source.params.placement)
  if (height === undefined || source.params.routine === "pocket-center")
    return null
  const start = probingStart(subject)
  const { anchors, stock, stockAnchor, fixtures } = subject.plate.setup
  if (start?.kind !== "anchor" || !anchors) return null
  // Machine XY reaches the bed through the snapshot's registration, as the viewer places it.
  const [x, y] = machineToBed(anchors)(start.machine)
  const stockSolid: Solid[] = stock
    ? [
        {
          name: "the stock",
          min: stockAnchor,
          max: [
            stockAnchor[0] + stock.width,
            stockAnchor[1] + stock.depth,
            stockAnchor[2] + stock.height,
          ],
        },
      ]
    : []
  const solid = [...stockSolid, ...fixtureSolids(fixtures)]
    .filter(
      (item) => standsUnder(item, [x, y]) && item.max[2] > height + EPSILON
    )
    .sort((a, b) => b.max[2] - a.max[2])
    .at(0)
  return solid ? { at: [x, y, height], solid } : null
}

/**
 * The probe travels over its start at the clearance and comes down to the start's height, then
 * the routine searches down from there: below the top of what stands there, it comes down into
 * it.
 */
const probe3dStartBelowTop: StageRule<"operation"> = {
  id: "origin/start-below-top",
  stage: "operation",
  label: "3D probing start above what is under it",
  description:
    "An anchored start's Z below the top of the stock or a fixture under it brings the probe down into it.",
  severity: "warning",
  configurable: false,
  test: (subject) => startBelowTop(subject) === null,
  explain: ({ first }) => {
    const found = startBelowTop(first)
    const z = found ? formatMillimetres(found.at[2]) : ""
    const where = found
      ? `${found.solid.min[2] < found.at[2] ? "inside" : "through"} ${found.solid.name}, whose top is at Z ${formatMillimetres(found.solid.max[2])}`
      : "below the top of what is under it"
    return {
      problem: `The probe comes down to Z ${z} ${where}: raise Z above it, or leave Z empty to search down from the clearance.`,
      about: operationSubject(first.operation.id),
      ...(found && { places: [{ kind: "point", at: found.at } as const] }),
    }
  },
  fixes: editOperation,
}

/** The advice for a 3D probing operation: its anchors, its start's height, and its order. */
export const ORIGIN_RULES: readonly StageRule<"operation">[] = [
  probe3dFactoryAnchors,
  probe3dStartBelowTop,
  probe3dBeforeAutoLevel,
]
