import { isProgramFileName } from "@/app/workspace/import-files"
import { compilePlate } from "@/domain/compile/compile"
import type { CompiledSection } from "@/domain/compile/compile"
import { diagnosticOperation } from "@/domain/diagnostics"
import type { Diagnostic } from "@/domain/diagnostics"
import { operationPhase } from "@/domain/operations/kinds"
import type { Operation, Phase } from "@/domain/operations/operation"
import { numberedPlate, plateLabel } from "@/domain/plate/plate"
import type { Group, Plate } from "@/domain/plate/plate"
import { sectionRowId } from "../selection"

type RowBase = {
  readonly id: string
  readonly plate: Plate
  readonly label: string
  /** The row's label with its ancestors': a matching plate or operation shows all it holds. */
  readonly search: string
  readonly subRows: TreeRow[]
}

export type TreeRow =
  | (RowBase & {
      readonly kind: "plate"
      readonly index: number
      readonly errors: number
    })
  | (RowBase & {
      readonly kind: "operation"
      readonly operation: Operation
      readonly index: number
      readonly count: number
      readonly phase: Phase
      readonly errors: number
    })
  | (RowBase & { readonly kind: "group"; readonly group: Group })
  | (RowBase & { readonly kind: "section"; readonly section: CompiledSection })

export const PHASE_LABELS: Record<Phase, string> = {
  setup: "Setup",
  machining: "Machining",
  finish: "Finish",
}

/** Names from files end in their extension (".nc", ".ngc", …); the tree shows them without it. */
const treeLabel = (name: string) =>
  isProgramFileName(name) ? name.replace(/\.[a-z0-9]+$/i, "") : name

const errorsOf = (diagnostics: readonly Diagnostic[], operationId?: string) =>
  diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "error" &&
      (operationId === undefined ||
        diagnosticOperation(diagnostic) === operationId)
  ).length

function sectionRow(
  plate: Plate,
  section: CompiledSection,
  parent: string
): TreeRow {
  const label = treeLabel(section.name)
  return {
    kind: "section",
    id: sectionRowId(plate.id, section.id),
    plate,
    section,
    label,
    search: `${parent} ${label}`,
    subRows: [],
  }
}

/**
 * The plate's groups as they apply to its program: a group keeps the sections that still
 * exist (editing an operation can remove some), a section belongs to the first group that
 * lists it, and a group left without sections is not shown. The tree and grouping both use
 * this view, so a stale group neither hides its sections nor keeps them from being regrouped.
 */
function liveGroups(plate: Plate): Group[] {
  const existing = new Set(
    compilePlate(plate).sections.map((section) => section.id)
  )
  const claimed = new Set<string>()
  const groups: Group[] = []
  for (const group of plate.groups) {
    const sectionIds: string[] = []
    for (const id of group.sectionIds)
      if (existing.has(id) && !claimed.has(id)) {
        claimed.add(id)
        sectionIds.push(id)
      }
    if (sectionIds.length) groups.push({ ...group, sectionIds })
  }
  return groups
}

/** An operation's sections, with the groups that start among them. */
function operationChildren(
  plate: Plate,
  sections: readonly CompiledSection[],
  groups: readonly Group[],
  byId: ReadonlyMap<string, CompiledSection>,
  parent: string
): TreeRow[] {
  const rows: TreeRow[] = []
  const grouped = new Set(groups.flatMap((group) => group.sectionIds))
  for (const section of sections) {
    const group = groups.find((item) => item.sectionIds[0] === section.id)
    if (group) {
      const label = group.name
      const search = `${parent} ${label}`
      rows.push({
        kind: "group",
        id: `group:${plate.id}:${group.id}`,
        plate,
        group,
        label,
        search,
        subRows: group.sectionIds.flatMap((id) => {
          const member = byId.get(id)
          return member ? [sectionRow(plate, member, search)] : []
        }),
      })
    } else if (!grouped.has(section.id))
      rows.push(sectionRow(plate, section, parent))
  }
  return rows
}

/** Plates, their operations, groups and program sections, as rows of the plate tree. */
export function buildTreeRows(
  plates: readonly Plate[],
  diagnosticsOf: (plate: Plate) => readonly Diagnostic[]
): TreeRow[] {
  return plates.map((plate, index) => {
    const compiled = compilePlate(plate)
    const diagnostics = diagnosticsOf(plate)
    const byId = new Map(
      compiled.sections.map((section) => [section.id, section])
    )
    const groups = liveGroups(plate)
    const label = plateLabel(plate, index)
    // A named plate is still found by its number.
    const plateSearch = `${numberedPlate(index)} ${plate.name}`
    return {
      kind: "plate",
      id: `plate:${plate.id}`,
      plate,
      index,
      errors: errorsOf(diagnostics),
      label,
      search: plateSearch,
      subRows: plate.operations.map((operation, position): TreeRow => {
        const phase = operationPhase(operation)
        const operationLabel = treeLabel(operation.name)
        const search = `${plateSearch} ${operationLabel} ${PHASE_LABELS[phase]}`
        return {
          kind: "operation",
          id: `operation:${operation.id}`,
          plate,
          operation,
          index: position,
          count: plate.operations.length,
          phase,
          errors: errorsOf(diagnostics, operation.id),
          label: operationLabel,
          search,
          subRows: operationChildren(
            plate,
            compiled.sections.filter(
              (section) => section.operationId === operation.id
            ),
            groups,
            byId,
            search
          ),
        }
      }),
    }
  })
}

/** Rows shown expanded until the user collapses them: plates and groups. */
const expandedByDefault = (row: TreeRow) =>
  row.kind === "plate" || row.kind === "group"

/** Every expanded row: the user's choices, and the defaults for rows they did not toggle. */
export function expandedState(
  rows: readonly TreeRow[],
  choices: Readonly<Record<string, boolean>>,
  byDefault: (row: TreeRow) => boolean = expandedByDefault
): Record<string, boolean> {
  const expanded: Record<string, boolean> = {}
  const visit = (row: TreeRow) => {
    if (row.subRows.length && (choices[row.id] ?? byDefault(row)))
      expanded[row.id] = true
    row.subRows.forEach(visit)
  }
  rows.forEach(visit)
  return expanded
}

/** Sections that can form a new group: adjacent in one operation, none grouped yet. */
export function groupableSections(
  plate: Plate,
  selected: readonly CompiledSection[]
): CompiledSection[] | null {
  if (selected.length < 2) return null
  const operationId = selected[0].operationId
  if (selected.some((section) => section.operationId !== operationId))
    return null
  const sections = compilePlate(plate).sections.filter(
    (section) => section.operationId === operationId
  )
  const indices = selected
    .map((section) => sections.findIndex((item) => item.id === section.id))
    .sort((a, b) => a - b)
  const contiguous = indices.every(
    (value, position) => position === 0 || value === indices[position - 1] + 1
  )
  const grouped = new Set(
    liveGroups(plate).flatMap((group) => group.sectionIds)
  )
  if (!contiguous || selected.some((section) => grouped.has(section.id)))
    return null
  return indices.map((position) => sections[position])
}
