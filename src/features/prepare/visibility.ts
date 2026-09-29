import { createAtom, useSelector } from "@tanstack/react-store"

/** Operations whose toolpaths the Prepare view leaves out: a view setting, never saved. */
const hiddenOperationsAtom = createAtom<ReadonlySet<string>>(new Set<string>())

export const useHiddenOperations = () => useSelector(hiddenOperationsAtom)

/** Hides an operation's toolpath, or shows it again. */
export function toggleOperationHidden(operationId: string) {
  hiddenOperationsAtom.set((hidden) => {
    const next = new Set(hidden)
    if (!next.delete(operationId)) next.add(operationId)
    return next
  })
}
