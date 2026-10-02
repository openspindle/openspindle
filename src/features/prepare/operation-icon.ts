import {
  ArrowDownToLine,
  Axis3d,
  CircuitBoard,
  FileCode2,
  LandPlot,
  SquareDashed,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { Operation } from "@/domain/operations/operation"
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
 * whatever performs it.
 */
export const probingIcon = ({
  task,
}: {
  readonly task: ProbingTask
}): LucideIcon => PROBING_ICONS[task]

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
