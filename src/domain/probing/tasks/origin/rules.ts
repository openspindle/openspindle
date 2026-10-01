import { operationSubject } from "../../../diagnostics"
import type { OperationRuleSubject, StageRule } from "../../../rules/stages"
import { setsWorkZ } from "./params"
import { planOrigin } from "./plan"
import {
  laterGrids,
  placementContext,
  touchesGridStarts,
} from "../../placement"
import type { ProbeStart } from "../../placement"
import { editOperation } from "../../rules"
import { strategySpecs } from "../../strategies"

/**
 * A 3D probing operation's start as its advice reads it; null for another operation, a strategy
 * the plate's machine does not have, or parameters or an anchored start that do not resolve
 * (the compiler reports those).
 */
function probingStart({
  operation,
  plate,
  kit,
}: OperationRuleSubject): ProbeStart | null {
  const { source } = operation
  if (source.kind !== "probing" || source.task !== "origin") return null
  const specs = strategySpecs(source, kit.probing)
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
 * A routine that sets work Z does so as auto Z-height does, from the position without height
 * compensation, while a later auto-level measures heights from its grid's first point: work Z is
 * exact after auto-level, and before it only where the grid starts. A grid from the probe
 * position does not start there even right after it, as the routine leaves the probe over what
 * it found rather than over the top it touched.
 */
const probe3dBeforeAutoLevel: StageRule<"operation"> = {
  id: "origin/before-grid",
  stage: "operation",
  label: "3D probing after auto-level",
  description:
    "Work Z set by 3D probing before an auto-level is exact only where the auto-level's grid starts.",
  severity: "warning",
  configurable: false,
  test: ({ operation, plate, kit }) => {
    const { source } = operation
    if (
      source.kind !== "probing" ||
      source.task !== "origin" ||
      !strategySpecs(source, kit.probing)
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
      "A later auto-level measures heights from its grid's first point, so work Z is off by any height difference between that point and the top this probing touches. Move 3D probing after Auto-level, or probe where the grid starts.",
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

/** The advice for a 3D probing operation: its anchors, and its order. */
export const ORIGIN_RULES: readonly StageRule<"operation">[] = [
  probe3dFactoryAnchors,
  probe3dBeforeAutoLevel,
]
