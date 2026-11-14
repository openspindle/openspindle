import { operationSubject } from "../../diagnostics"
import { workOriginOnMachine } from "../../plate/work-origin"
import { editOperation } from "../../rules/diagnostics"
import { methodFor } from "../../probing/strategies"
import { setsWorkXY } from "../../probing/tasks/origin/params"
import type { OperationRuleSubject, StageRule } from "../../rules/stages"
import { HEIGHT_MAP } from "./strategies/height-map"
import { ROUTINES } from "./strategies/routines"
import { Z_PROBE } from "./strategies/z-probe"

/** M495's compiled work XY cannot follow an earlier M480's measured work zero. */
function earlierOrigin({ operation, plate, kit }: OperationRuleSubject) {
  const { source } = operation
  const machine = kit.probing
  if (
    !machine ||
    source.kind !== "probing" ||
    (source.task !== "touch-off" && source.task !== "grid") ||
    source.params.placement.kind !== "anchor" ||
    !workOriginOnMachine(plate.setup)
  )
    return null
  const method = methodFor(source, machine, plate)
  if (method?.id !== Z_PROBE.id && method?.id !== HEIGHT_MAP.id) return null
  const index = plate.operations.findIndex((item) => item.id === operation.id)
  if (index < 0) return null
  return (
    plate.operations
      .slice(0, index)
      .find(
        ({ source: previous }) =>
          previous.kind === "probing" &&
          previous.task === "origin" &&
          setsWorkXY(previous.params.routine, previous.params.axes).some(
            Boolean
          ) &&
          methodFor(previous, machine, plate)?.id === ROUTINES.id
      ) ?? null
  )
}

export const Z1_PROBING_RULES: readonly StageRule<"operation">[] = [
  {
    id: "makera-z1/probing-after-origin",
    stage: "operation",
    label: "Anchored probing before measured work XY",
    description:
      "M495 uses the plate's compiled work XY, which becomes stale after an M480 origin routine changes work X or Y.",
    severity: "error",
    configurable: false,
    test: (subject) => earlierOrigin(subject) === null,
    explain: ({ first }) => ({
      problem: `${first.operation.name} uses anchored work coordinates after ${earlierOrigin(first)?.name ?? "3D probing"} changes work X or Y, so it would probe a shifted point. Move it before that origin routine, or use the probe position.`,
      about: operationSubject(first.operation.id),
    }),
    fixes: editOperation,
  },
]
