import {
  ArrowDownToLine,
  Axis3d,
  CircuitBoard,
  FileCode2,
  LandPlot,
  SquareDashed,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ProbingSourceKind } from "@/domain/operations/kinds"
import type { Operation } from "@/domain/operations/operation"

/** The probing operations' icons, wherever they are offered or listed. */
export const PROBING_ICONS: Record<ProbingSourceKind, LucideIcon> = {
  "auto-level": LandPlot,
  "auto-z-height": ArrowDownToLine,
  "auto-scan": SquareDashed,
  "probe-3d": Axis3d,
}

/** An operation's icon, shared by the tree, inspector and job view. */
export function operationIcon(operation: Operation): LucideIcon {
  switch (operation.source.kind) {
    case "file":
    case "unsupported":
      return FileCode2
    case "pcb":
      return CircuitBoard
    default:
      return PROBING_ICONS[operation.source.kind]
  }
}

export function useOperationIcon(): (operation: Operation) => LucideIcon {
  return operationIcon
}
