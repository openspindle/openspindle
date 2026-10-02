import { createAtom, useSelector } from "@tanstack/react-store"

/** Operations whose toolpaths the Prepare view leaves out: a view setting, never saved. */
const hiddenOperationsAtom = createAtom<ReadonlySet<string>>(new Set<string>())

/** Fixtures the Prepare view leaves out, by `fixtureKey`: a view setting, never saved. */
const hiddenFixturesAtom = createAtom<ReadonlySet<string>>(new Set<string>())

/** How a hidden fixture is kept: its plate's id and its own. */
export const fixtureKey = (plateId: string, fixtureId: string) =>
  `${plateId}:${fixtureId}`

export const useHiddenOperations = () => useSelector(hiddenOperationsAtom)
export const useHiddenFixtures = () => useSelector(hiddenFixturesAtom)

/** The set with `keys` taken out, or put in. */
function toggled(
  set: ReadonlySet<string>,
  keys: readonly string[],
  hidden: boolean
) {
  const next = new Set(set)
  for (const key of keys) {
    if (hidden) next.add(key)
    else next.delete(key)
  }
  return next
}

/** Hides an operation's toolpath, or shows it again. */
export function toggleOperationHidden(operationId: string) {
  hiddenOperationsAtom.set((hidden) => {
    const next = new Set(hidden)
    if (!next.delete(operationId)) next.add(operationId)
    return next
  })
}

/** Hides operations' toolpaths, or shows them again. */
export const setOperationsHidden = (
  operationIds: readonly string[],
  hidden: boolean
) => hiddenOperationsAtom.set((set) => toggled(set, operationIds, hidden))

/** Hides fixtures of a plate, or shows them again. */
export const setFixturesHidden = (
  plateId: string,
  fixtureIds: readonly string[],
  hidden: boolean
) =>
  hiddenFixturesAtom.set((set) =>
    toggled(
      set,
      fixtureIds.map((id) => fixtureKey(plateId, id)),
      hidden
    )
  )
