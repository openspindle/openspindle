import { useEffect, useMemo, useRef, useState } from "react"
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
import { useArrangeSelection } from "../arrange/arrange-state"
import { useSelectSetupItem } from "../arrange/use-arrange-events"
import {
  revealRow,
  sectionSelectionAtom,
  selectSections,
  useRevealRequest,
} from "../selection"
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

/** What a selectable row selects: a section or a path, of an operation; null for other rows. */
function selectableOf(row: TreeRow) {
  if (row.kind === "section")
    return {
      kind: row.kind,
      plateId: row.plate.id,
      operationId: row.section.operationId,
    }
  if (row.kind === "path")
    return {
      kind: row.kind,
      plateId: row.plate.id,
      operationId: row.operation.id,
    }
  return null
}

/**
 * Plates with their fixtures and operations, and the operations' program sections: select,
 * hide, add, reorder, group and search.
 */
export function PlateTree({ className }: { className?: string }) {
  const plates = useWorkspace((state) => state.plates)
  const tools = useWorkspace((state) => state.tools)
  const selectedPlateId = useWorkspace((state) => state.selectedPlateId)
  const diagnosticsOf = useDiagnosticsOf()
  const selection = usePrepareSelection()
  const selectItem = useSelectSetupItem()
  const arranged = useArrangeSelection()
  const selectedFixtureId =
    arranged?.item.kind === "fixture" && arranged.plateId === selectedPlateId
      ? arranged.item.id
      : null
  const selectedStockPlateId =
    arranged?.item.kind === "stock" && arranged.plateId === selectedPlateId
      ? selectedPlateId
      : null
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
    enableRowSelection: (row) => selectableOf(row.original) !== null,
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
  // A row selected in the 3D view: its ancestors expand, then it scrolls into view.
  const reveal = useRevealRequest()
  useEffect(() => {
    if (!reveal) return
    setExpanded((current) => ({
      ...current,
      ...Object.fromEntries(reveal.ancestors.map((id) => [id, true])),
    }))
  }, [reveal])
  useEffect(() => {
    if (!reveal) return
    const index = rows.findIndex((row) => row.id === reveal.rowId)
    if (index < 0) return
    virtualizer.scrollToIndex(index, { align: "auto" })
    revealRow(null)
  }, [reveal, rows, virtualizer])
  const toggle = (row: TreeTableRow) =>
    (searching ? setSearchExpanded : setExpanded)((current) => ({
      ...current,
      [row.id]: !row.getIsExpanded(),
    }))
  // A section or a path selects its operation too; Shift extends over its kind in that operation.
  const selectSection = (row: TreeTableRow, event: React.MouseEvent) => {
    const selected = selectableOf(row.original)
    if (!selected) return
    selection.selectOperation(selected.plateId, selected.operationId)
    if (event.metaKey || event.ctrlKey) {
      row.toggleSelected()
      return
    }
    const peers = rows.filter((item) => {
      const peer = selectableOf(item.original)
      return (
        peer?.kind === selected.kind &&
        peer.plateId === selected.plateId &&
        peer.operationId === selected.operationId
      )
    })
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
            aria-label="Search plates, fixtures, operations and sections"
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
        aria-label="Plates, fixtures and operations"
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
                  selectedFixtureId={selectedFixtureId}
                  selectedStockPlateId={selectedStockPlateId}
                  // As clicking the stock in the viewer; without stock, its panel to add one.
                  onSelectStock={(plateId) => {
                    const plate = plates.find(({ id }) => id === plateId)
                    if (plate?.setup.stock)
                      selectItem(plateId, { kind: "stock" })
                    else selection.showPlateSetup(plateId, "stock")
                  }}
                  onToggle={() => toggle(row)}
                  // As clicking beside the plate's setup in the viewer: the plate alone.
                  onSelectPlate={(plateId) => selectItem(plateId, null)}
                  onSelectOperation={selection.selectOperation}
                  onSelectFixture={(plateId, fixtureId) =>
                    selectItem(plateId, { kind: "fixture", id: fixtureId })
                  }
                  onShowFixtures={(plateId) =>
                    selection.showPlateSetup(plateId, "fixtures")
                  }
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
