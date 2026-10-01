import { operationSubject } from "../../../diagnostics"
import type { Area } from "../../../diagnostics"
import { plateMachining } from "../../../compile/toolpath-bounds"
import { translation } from "../../../geometry/frame"
import { boxRect, contains, mapRect, rectAt } from "../../../geometry/rect"
import { operationPhase } from "../../../operations/kinds"
import type { Operation } from "../../../operations/operation"
import { workOriginOnMachine } from "../../../plate/work-origin"
import type { OperationRuleSubject, StageRule } from "../../../rules/stages"
import { editOperation } from "../../rules"
import { setsWorkXY } from "../origin/params"
import { outlineTarget } from "./params"

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
  if (
    source.kind !== "probing" ||
    source.task !== "outline" ||
    outlineTarget(source.params).kind !== "toolpath" ||
    !stock
  )
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

/**
 * The 3D probing after an outline operation, and before the plate's machining, that sets work X
 * or Y while the program sets neither before the trace: the trace runs where the machine's work
 * X and Y were left, and the cuts go where the probing sets them. Null for another operation,
 * for a plate whose program sets work X and Y before everything (`workOriginOnMachine`), or
 * without such probing.
 */
function originAfterOutline({
  operation,
  plate,
}: OperationRuleSubject): Operation | null {
  const { source } = operation
  if (source.kind !== "probing" || source.task !== "outline") return null
  // Edges are traced in machine coordinates, wherever work X and Y are.
  if (outlineTarget(source.params).kind !== "toolpath") return null
  if (workOriginOnMachine(plate.setup)) return null
  const index = plate.operations.findIndex((item) => item.id === operation.id)
  if (index < 0) return null
  const later = plate.operations.slice(index + 1)
  const machining = later.findIndex((item) => operationPhase(item) !== "setup")
  return (
    later
      .slice(0, machining < 0 ? later.length : machining)
      .find(
        ({ source: next }) =>
          next.kind === "probing" &&
          next.task === "origin" &&
          setsWorkXY(next.params.routine, next.params.axes).some(Boolean)
      ) ?? null
  )
}

const beforeOrigin: StageRule<"operation"> = {
  id: "outline/before-origin",
  stage: "operation",
  label: "Outline at the work origin",
  description:
    "A trace before 3D probing that sets work X or Y follows where the machine's work origin was left, not where the cuts go, unless the program sets the work origin first, which it does once the plate's anchors are read from its device.",
  severity: "warning",
  configurable: false,
  test: (subject) => !originAfterOutline(subject),
  explain: ({ first }) => {
    const origin = originAfterOutline(first)?.name ?? "3D probing"
    return {
      problem: `${first.operation.name} runs before ${origin} sets work X and Y, so it traces where the machine's work origin was left, not where the cuts go. Use Read anchors so the program sets the work origin first, or move it after ${origin}.`,
      about: operationSubject(first.operation.id),
    }
  },
  fixes: {
    offer: ({ first }) => [
      { kind: "read-anchors" },
      { kind: "edit-operation", operationId: first.operation.id },
    ],
  },
}

/** The advice for an outline operation: its outline against the stock, and its order. */
export const OUTLINE_RULES: readonly StageRule<"operation">[] = [
  outlineOffStock,
  afterMachining,
  beforeOrigin,
]
