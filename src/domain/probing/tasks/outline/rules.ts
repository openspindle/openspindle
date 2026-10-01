import { operationSubject } from "../../../diagnostics"
import type { Area } from "../../../diagnostics"
import { plateMachining } from "../../../compile/toolpath-bounds"
import { translation } from "../../../geometry/frame"
import { boxRect, contains, mapRect, rectAt } from "../../../geometry/rect"
import { operationPhase } from "../../../operations/kinds"
import type { OperationRuleSubject, StageRule } from "../../../rules/stages"
import { editOperation } from "../../rules"

/**
 * Where an outline operation's outline, the plate's cuts, leaves the stock as placed, at the
 * stock top where the trace follows it; null for another operation, without stock or cuts, or
 * with the outline on the stock.
 */
function outlineBeyondStock({
  operation,
  plate,
  kit,
}: OperationRuleSubject): Area | null {
  const { source } = operation
  const { stock, stockAnchor, workOrigin } = plate.setup
  if (source.kind !== "probing" || source.task !== "outline" || !stock)
    return null
  const toolpath = plateMachining(plate, kit).toolpath()
  if (!toolpath.ok) return null
  const onBed = mapRect(
    boxRect<"work">(toolpath.bounds),
    translation<"work", "bed">([workOrigin[0], workOrigin[1]])
  )
  const stockRect = rectAt<"bed">(
    [stockAnchor[0], stockAnchor[1]],
    [stock.width, stock.depth]
  )
  if (contains(stockRect, onBed)) return null
  const top = stockAnchor[2] + stock.height
  return {
    kind: "area",
    min: [onBed.min[0], onBed.min[1], top],
    max: [onBed.max[0], onBed.max[1], top],
  }
}

const outlineOffStock: StageRule<"operation"> = {
  id: "outline/outside-stock",
  stage: "operation",
  label: "Outline on the stock",
  description:
    "Cuts that reach beyond the stock as placed are worth checking, which is what an outline trace is for.",
  severity: "warning",
  configurable: false,
  test: (subject) => !outlineBeyondStock(subject),
  explain: ({ first }) => {
    const outline = outlineBeyondStock(first)
    return {
      problem:
        "The cuts reach beyond the stock as placed; the trace follows where they go.",
      about: operationSubject(first.operation.id),
      ...(outline && { places: [outline] }),
    }
  },
  fixes: editOperation,
}

const afterMachining: StageRule<"operation"> = {
  id: "outline/after-machining",
  stage: "operation",
  label: "Outline before machining",
  description:
    "A trace after machining has started checks the outline too late.",
  severity: "warning",
  configurable: false,
  test: ({ operation, plate }) => {
    const { source } = operation
    if (source.kind !== "probing" || source.task !== "outline") return true
    const index = plate.operations.findIndex((item) => item.id === operation.id)
    return plate.operations
      .slice(0, Math.max(0, index))
      .every((item) => operationPhase(item) === "setup")
  },
  explain: ({ first }) => ({
    problem: `${first.operation.name} runs after machining operations. Move it before them to check the outline first.`,
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

/** The advice for an outline operation: its outline against the stock, and its order. */
export const OUTLINE_RULES: readonly StageRule<"operation">[] = [
  outlineOffStock,
  afterMachining,
]
