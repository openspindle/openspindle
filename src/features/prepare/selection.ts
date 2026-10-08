import { createAtom, useSelector } from "@tanstack/react-store"
import type { RowSelectionState } from "@tanstack/react-table"
import type { CompiledPlate, CompiledSection } from "@/domain/compile/compile"
import type { Plate } from "@/domain/plate/plate"

/** Tree row id of a program section; sections are selected per plate. */
export const sectionRowId = (plateId: string, sectionId: string) =>
  `section:${plateId}:${sectionId}`

/** Tree row id of a path of an operation's toolpath (`toolpathParts`), selected as sections are. */
export const pathRowId = (
  plateId: string,
  operationId: string,
  index: number
) => `path:${plateId}:${operationId}:${index}`

/**
 * Program sections and toolpath paths selected in the plate tree (by row id): sections are
 * grouped, and both are highlighted in the viewer.
 */
export const sectionSelectionAtom = createAtom<RowSelectionState>({})

export const useSectionSelection = () => useSelector(sectionSelectionAtom)
export const selectSections = (rowIds: readonly string[]) =>
  sectionSelectionAtom.set(() =>
    Object.fromEntries(rowIds.map((id) => [id, true] as const))
  )
export const clearSectionSelection = () => sectionSelectionAtom.set(() => ({}))

/** Adds a row to the selection, or takes it away. */
export const toggleRowSelection = (rowId: string) =>
  sectionSelectionAtom.set((current) => {
    if (!Object.hasOwn(current, rowId)) return { ...current, [rowId]: true }
    const { [rowId]: _removed, ...rest } = current
    return rest
  })

/** A row selected outside the plate tree, which the tree expands to and scrolls into view. */
export type RevealRequest = {
  readonly rowId: string
  /** The rows it lies under, from the plate down. */
  readonly ancestors: readonly string[]
}

const revealAtom = createAtom<RevealRequest | null>(null)

export const useRevealRequest = () => useSelector(revealAtom)
export const revealRow = (request: RevealRequest | null) =>
  revealAtom.set(() => request)

/** The paths of a plate's operations selected in the plate tree: their indices, by operation. */
export function selectedPaths(
  plate: Plate,
  selection: Readonly<RowSelectionState>
): ReadonlyMap<string, ReadonlySet<number>> {
  const prefix = `path:${plate.id}:`
  const paths = new Map<string, Set<number>>()
  for (const id of Object.keys(selection)) {
    if (!id.startsWith(prefix)) continue
    const rest = id.slice(prefix.length)
    const cut = rest.lastIndexOf(":")
    const operationId = rest.slice(0, cut)
    const indices = paths.get(operationId) ?? new Set<number>()
    indices.add(Number(rest.slice(cut + 1)))
    paths.set(operationId, indices)
  }
  return paths
}

export function selectedSections(
  plate: Plate,
  compiled: CompiledPlate,
  selection: Readonly<RowSelectionState>
): CompiledSection[] {
  return compiled.sections.filter((section) =>
    Object.hasOwn(selection, sectionRowId(plate.id, section.id))
  )
}
