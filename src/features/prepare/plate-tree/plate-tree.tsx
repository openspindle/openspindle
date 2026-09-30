import { useMemo, useRef, useState } from "react"
import {
  columnFilteringFeature,
  createColumnHelper,
  createExpandedRowModel,
  createFilteredRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowExpandingFeature,
  rowSelectionFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import type { Row } from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { cn } from "cn"
import { Layers3, Plus, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardTitle } from "@/components/ui/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { useDiagnosticsOf } from "@/app/workspace/use-plate-diagnostics"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { openDialog } from "@/features/shell/dialogs"
import { sectionSelectionAtom, selectSections } from "../selection"
import { SelectionBar } from "./selection-bar"
import { TreeRowView } from "./tree-row"
import { buildTreeRows, expandedState } from "./tree-rows"
import type { TreeRow } from "./tree-rows"
import { useAddPlate } from "./use-add-plate"
import { usePrepareSelection } from "./use-prepare-selection"

const features = tableFeatures({
  rowExpandingFeature,
  rowSelectionFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  expandedRowModel: createExpandedRowModel(),
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
})
export type TreeTableRow = Row<typeof features, TreeRow>

const columnHelper = createColumnHelper<typeof features, TreeRow>()
const columns = columnHelper.columns([
  columnHelper.accessor((row) => row.search, {
    id: "search",
    filterFn: "includesString",
  }),
])

const ROW_HEIGHT = 36

/** Plates, their operations and program sections: select, reorder, group and search. */
export function PlateTree({ className }: { className?: string }) {
  const plates = useWorkspace((state) => state.plates)
  const tools = useWorkspace((state) => state.tools)
  const selectedPlateId = useWorkspace((state) => state.selectedPlateId)
  const diagnosticsOf = useDiagnosticsOf()
  const selection = usePrepareSelection()
  const addPlate = useAddPlate()
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  /** Rows collapsed or expanded during the current search; a new search starts over. */
  const [searchExpanded, setSearchExpanded] = useState<Record<string, boolean>>(
    {}
  )
  const data = useMemo(
    () => buildTreeRows(plates, tools, diagnosticsOf),
    [plates, tools, diagnosticsOf]
  )
  const searching = query.trim() !== ""
  // The row model reads the expanded state itself, so every expanded row is listed explicitly.
  // A search shows every match expanded, unless collapsed during that search.
  const expandedRows = useMemo(
    () =>
      searching
        ? expandedState(data, searchExpanded, () => true)
        : expandedState(data, expanded),
    [data, expanded, searchExpanded, searching]
  )
  const table = useTable({
    features,
    columns,
    data,
    getRowId: (row) => row.id,
    getSubRows: (row) => row.subRows,
    filterFromLeafRows: true,
    globalFilterFn: "includesString",
    enableRowSelection: (row) => row.original.kind === "section",
    enableSubRowSelection: false,
    atoms: { rowSelection: sectionSelectionAtom },
    state: {
      globalFilter: query.trim(),
      expanded: expandedRows,
    },
  })
  const rows = table.getRowModel().rows
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => rows[index].id,
  })
  const toggle = (row: TreeTableRow) =>
    (searching ? setSearchExpanded : setExpanded)((current) => ({
      ...current,
      [row.id]: !row.getIsExpanded(),
    }))
  const selectSection = (row: TreeTableRow, event: React.MouseEvent) => {
    if (row.original.kind !== "section") return
    const { plate, section } = row.original
    selection.selectOperation(plate.id, section.operationId)
    if (event.metaKey || event.ctrlKey) {
      row.toggleSelected()
      return
    }
    const peers = rows.filter(
      (item) =>
        item.original.kind === "section" &&
        item.original.plate.id === plate.id &&
        item.original.section.operationId === section.operationId
    )
    const anchor = peers.findIndex((item) => item.getIsSelected())
    const target = peers.indexOf(row)
    if (event.shiftKey && anchor >= 0)
      selectSections(
        peers
          .slice(Math.min(anchor, target), Math.max(anchor, target) + 1)
          .map((item) => item.id)
      )
    else selectSections([row.id])
  }
  return (
    <section
      className={cn("flex min-h-0 flex-col border-t", className)}
      aria-label="Plates"
    >
      <header className="flex shrink-0 items-center gap-2 px-4 py-3">
        <Layers3 className="size-4" />
        <CardTitle role="heading" aria-level={2}>
          Plates
        </CardTitle>
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search plates, operations and sections"
            placeholder="Search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setSearchExpanded({})
            }}
          />
        </InputGroup>
        <Badge
          variant="secondary"
          className="font-numeric"
          aria-label={`${plates.length} plates`}
        >
          {plates.length}
        </Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          title="Add plate"
          aria-label="Add plate"
          onClick={addPlate}
        >
          <Plus />
        </Button>
      </header>
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
        role="tree"
        aria-label="Plates and operations"
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]
            return (
              <div
                key={item.key}
                className="absolute top-0 left-0 w-full"
                style={{
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <TreeRowView
                  row={row}
                  selectedPlateId={selectedPlateId}
                  selectedOperationId={selection.operationId}
                  onToggle={() => toggle(row)}
                  onSelectPlate={selection.selectPlate}
                  onSelectOperation={selection.selectOperation}
                  onSelectSection={(event) => selectSection(row, event)}
                />
              </div>
            )
          })}
        </div>
        {!plates.length && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => openDialog({ kind: "add-operation" })}
          >
            <Plus />
            Add program
          </Button>
        )}
      </div>
      <SelectionBar />
    </section>
  )
}
