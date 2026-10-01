import {
  ArrowDownToDot,
  ArrowDownToLine,
  Axis3d,
  CircuitBoard,
  FileCode2,
  LandPlot,
  SquareDashed,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Operation, ProbingSource } from "@/domain/operations/operation"
import { GENERIC_STRATEGIES } from "@/domain/probing/strategies"
import type { ProbingTask } from "@/domain/probing/strategy"

/** The probing operations' icons by task. */
const PROBING_ICONS: Record<ProbingTask, LucideIcon> = {
  grid: LandPlot,
  "touch-off": ArrowDownToLine,
  outline: SquareDashed,
  origin: Axis3d,
}

/**
 * A probing strategy's icon, wherever it is offered or its operations are listed: its task's,
 * and for a machine's own touch-off, such as the Z1 firmware's Z probe, one apart from Surface
 * touch.
 */
export function probingIcon({
  task,
  strategy,
}: Pick<ProbingSource, "task" | "strategy">): LucideIcon {
  const generic = GENERIC_STRATEGIES.some((item) => item.id === strategy)
  return task === "touch-off" && !generic ? ArrowDownToDot : PROBING_ICONS[task]
}

/** An operation's icon, shared by the tree, inspector and job view. */
export function operationIcon(operation: Operation): LucideIcon {
  const { source } = operation
  switch (source.kind) {
    case "file":
    case "unsupported":
      return FileCode2
    case "pcb":
      return CircuitBoard
    case "probing":
      return probingIcon(source)
  }
}

export function useOperationIcon(): (operation: Operation) => LucideIcon {
  return operationIcon
}
