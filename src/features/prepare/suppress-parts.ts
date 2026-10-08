import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import type { Operation } from "@/domain/operations/operation"
import {
  suppressedParts,
  suppressionPoints,
} from "@/domain/operations/toolpath-parts"
import type { Plate } from "@/domain/plate/plate"

/**
 * Changes which parts of an operation's toolpath it suppresses, as the tree, the inspector and
 * picking in the 3D view do: one at a time, only one kept, all inverted, or none. Points that
 * match no part stay until all are cleared.
 */
export function useSuppressParts() {
  const workspace = useWorkspaceStore()
  const set = (
    plate: Plate,
    operation: Operation,
    change: (matched: ReadonlySet<number>, count: number) => Set<number>
  ) => {
    const current = suppressedParts(operation)
    if (!current) return
    const { parts, matched, unmatched } = current
    workspace.dispatch({
      type: "operation.suppressParts",
      plateId: plate.id,
      operationId: operation.id,
      points: suppressionPoints(
        parts,
        change(matched, parts.length),
        unmatched
      ),
    })
  }
  const all = (count: number) =>
    new Set(Array.from({ length: count }, (_, index) => index))
  return {
    /** Suppresses the part, or cuts it again. */
    toggle: (plate: Plate, operation: Operation, index: number) =>
      set(plate, operation, (matched) => {
        const next = new Set(matched)
        if (!next.delete(index)) next.add(index)
        return next
      }),
    /** Suppresses every part but this one. */
    only: (plate: Plate, operation: Operation, index: number) =>
      set(plate, operation, (_matched, count) => {
        const next = all(count)
        next.delete(index)
        return next
      }),
    /** Suppresses the parts that run, and runs those suppressed. */
    invert: (plate: Plate, operation: Operation) =>
      set(
        plate,
        operation,
        (matched, count) =>
          new Set([...all(count)].filter((index) => !matched.has(index)))
      ),
    /** Cuts every part again, and forgets points that match none. */
    clear: (plate: Plate, operation: Operation) =>
      workspace.dispatch({
        type: "operation.suppressParts",
        plateId: plate.id,
        operationId: operation.id,
        points: [],
      }),
  }
}
