import { useCallback, useId, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Check, Search } from "lucide-react"
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_equals,
  filterFn_includesString,
  functionalUpdate,
  globalFilteringFeature,
  metaHelper,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import type {
  CellContext,
  ColumnFiltersState,
  Header,
  ReactTable,
  RowSelectionState,
  SortFn,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { Button } from "@/components/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ToolImage } from "@/components/workspace/tool-image"
import { catalogForTool } from "@/app/tools/tool-catalog-store"
import { hasToolPicture } from "@/app/tools/tool-picture-cache"
import type { LoadedToolCatalog } from "@/app/tools/tool-catalog-store"
import { toolKindKey } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { formatShankDiameter, formatToolNumber } from "@/domain/tools/format"
import { OptionSelect } from "@/components/option-select"
import { THUMBNAIL, ToolPicture } from "./tool-picture"
import { compareToolNames, toolKindLabel } from "./tool-format"

/** Catalog scopes besides a packaged catalog's id. */
export const ALL_CATALOGS = "all"
export const MY_TOOLS = "my"
const ALL_SHANKS = "all"

/** Shanks to the micrometre, so an inch shank's millimetres read as one size. */
const shankKey = (diameter: number | null) =>
  diameter === null ? undefined : String(Math.round(diameter * 1000) / 1000)

/** Every type, the types the caller recommends, or one type. */
export type ToolTypeFilter =
  | { readonly by: "all" }
  | { readonly by: "recommended" }
  | { readonly by: "kind"; readonly kind: string }
const ALL_TYPES: ToolTypeFilter = { by: "all" }
const RECOMMENDED_TYPES: ToolTypeFilter = { by: "recommended" }

/** The type filter as a select value; kinds are prefixed so none reads as another choice. */
const KIND_VALUE = "kind:"
const typeFilterValue = (type: ToolTypeFilter) =>
  type.by === "kind" ? `${KIND_VALUE}${type.kind}` : type.by
function typeFilterFromValue(value: string): ToolTypeFilter {
  if (value.startsWith(KIND_VALUE))
    return { by: "kind", kind: value.slice(KIND_VALUE.length) }
  return value === RECOMMENDED_TYPES.by ? RECOMMENDED_TYPES : ALL_TYPES
}
function typeFilterLabel(type: ToolTypeFilter) {
  if (type.by === "kind") return toolKindLabel(type.kind)
  return type.by === "recommended" ? "Recommended" : "All types"
}

/** Whether a tool is one of the recommended types; null when there is no recommendation. */
export type ToolRecommendation = ((tool: Tool) => boolean) | null

export function recommendTools(kinds: readonly string[]): ToolRecommendation {
  if (!kinds.length) return null
  const keys = new Set(kinds.map(toolKindKey))
  return (tool) => keys.has(toolKindKey(tool.kind))
}

export interface ToolFilter {
  /** Matched case-insensitively against name, type, vendor, product ID and diameter. */
  query: string
  type: ToolTypeFilter
  /** ALL_SHANKS or a shank diameter as shankKey writes it. */
  shank: string
  /** ALL_CATALOGS, MY_TOOLS or a packaged catalog's id. */
  catalog: string
}
const INITIAL_FILTER: ToolFilter = {
  query: "",
  type: ALL_TYPES,
  shank: ALL_SHANKS,
  catalog: ALL_CATALOGS,
}

interface ToolRow {
  tool: Tool
  /** The packaged catalog the tool comes from unchanged, otherwise MY_TOOLS. */
  catalog: string
  /** One of the types the caller recommends. */
  recommended: boolean
}

const toolTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowSelectionFeature,
  columnVisibilityFeature,
  tableMeta: metaHelper<{ inUseId: string; disabled: boolean }>(),
  columnMeta: metaHelper<{ headClassName?: string; cellClassName?: string }>(),
})
type Features = typeof toolTableFeatures
export type ToolTableInstance = ReactTable<Features, ToolRow>

const column = createColumnHelper<Features, ToolRow>()
const byName: SortFn<Features, ToolRow> = (a, b, columnId) =>
  compareToolNames(a.getValue<string>(columnId), b.getValue<string>(columnId))

/**
 * A tool's cutting end with its name, type and vendor (a tool without dimensions shows its
 * product photo, if any); the button makes the row keyboard-selectable.
 */
function ToolNameCell({ row, table }: CellContext<Features, ToolRow, string>) {
  const { tool } = row.original
  const meta = table.options.meta
  return (
    <Item
      size="xs"
      render={
        <Button
          variant="ghost"
          className="h-auto w-full justify-start whitespace-normal"
          aria-label={`Edit ${tool.name}`}
          disabled={meta?.disabled}
        />
      }
    >
      <ItemMedia className={THUMBNAIL.className}>
        {hasToolPicture(tool) ? (
          <ToolPicture tool={tool} framing="tip" size={THUMBNAIL} />
        ) : (
          <ToolImage tool={tool} className={THUMBNAIL.className} />
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full truncate" title={tool.name}>
          {tool.id === meta?.inUseId && <Check aria-label="Selected tool" />}
          {tool.name}
        </ItemTitle>
        <ItemDescription>
          {toolKindLabel(tool.kind)}
          {tool.vendor ? ` · ${tool.vendor}` : ""}
        </ItemDescription>
      </ItemContent>
    </Item>
  )
}

/** Unknown measurements sort last in either direction. */
const measurement = (
  id: string,
  header: string,
  read: (tool: Tool) => number | null,
  style: "count" | "millimeters"
) =>
  column.accessor((row) => read(row.tool) ?? undefined, {
    id,
    header,
    sortFn: sortFn_basic,
    sortUndefined: "last",
    meta: { headClassName: "w-px" },
    cell: (context) => (
      <span className="font-numeric">
        {formatToolNumber(context.getValue(), style)}
      </span>
    ),
  })

const columns = column.columns([
  column.accessor((row) => row.tool.name, {
    id: "name",
    header: "Tool",
    sortFn: byName,
    cell: ToolNameCell,
    // The name takes the width the measurements leave; its longest shown name would
    // otherwise widen the table past the list's scrollbar.
    meta: { cellClassName: "max-w-0" },
  }),
  measurement("diameter", "Ø mm", (tool) => tool.diameter, "millimeters"),
  measurement(
    "shank",
    "Shank",
    (tool) => tool.geometry.shankDiameter,
    "millimeters"
  ),
  measurement("flutes", "Flutes", (tool) => tool.flutes, "count"),
  // Filter-only columns, hidden from view. The kind is compared loosely, as toolKindKey
  // does, so case variants of the same type ("Probe", "probe") are one filter option.
  column.accessor((row) => toolKindKey(row.tool.kind), {
    id: "kind",
    filterFn: filterFn_equals,
  }),
  column.accessor((row) => shankKey(row.tool.geometry.shankDiameter), {
    id: "shankSize",
    filterFn: filterFn_equals,
  }),
  column.accessor("catalog", { filterFn: filterFn_equals }),
  column.accessor("recommended", { filterFn: filterFn_equals }),
  column.accessor(
    ({ tool }) =>
      `${tool.name} ${tool.kind} ${tool.vendor ?? ""} ${tool.productId ?? ""} ${tool.diameter ?? ""}`,
    { id: "search" }
  ),
])
const FILTER_COLUMNS = {
  kind: false,
  shankSize: false,
  catalog: false,
  recommended: false,
  search: false,
}

interface ToolTableOptions {
  /** Library and catalog tools, merged. */
  tools: readonly Tool[]
  catalogs: readonly LoadedToolCatalog[]
  /** The caller's recommended types: a type filter the table opens on. */
  recommendation: ToolRecommendation
  /** The tool currently in use, marked with a check. */
  inUseId: string
  /** The tool open in the editor, which is the selected row. */
  editingId: string | null
  disabled: boolean
  /** A row was chosen for editing; the selection follows `editingId`. */
  onEditTool: (tool: Tool) => void
}

/**
 * The tool list as a TanStack table: every tool sorted by name (ties in any sorted
 * column keep that order), filtered by type (or the recommended types), shank, catalog
 * and a search across name, type, vendor, product ID and diameter, with the edited tool
 * selected. A recommendation is where the list starts, unless the tool in use is of
 * another type; it never hides a tool from the other filters.
 */
export function useToolTable({
  tools,
  catalogs,
  recommendation,
  inUseId,
  editingId,
  disabled,
  onEditTool,
}: ToolTableOptions) {
  const [filter, setFilter] = useState((): ToolFilter => {
    const inUse = tools.find((tool) => tool.id === inUseId)
    const recommended =
      recommendation !== null && (!inUse || recommendation(inUse))
    return {
      ...INITIAL_FILTER,
      type: recommended ? RECOMMENDED_TYPES : ALL_TYPES,
    }
  })
  const data = useMemo(
    () =>
      tools
        .map((tool): ToolRow => ({
          tool,
          catalog: catalogForTool(tool, catalogs)?.id ?? MY_TOOLS,
          recommended: recommendation?.(tool) ?? false,
        }))
        .sort((a, b) => compareToolNames(a.tool.name, b.tool.name)),
    [tools, catalogs, recommendation]
  )
  const kinds = useMemo(
    () => [...new Set(tools.map((tool) => toolKindKey(tool.kind)))].sort(),
    [tools]
  )
  const shanks = useMemo(() => {
    const keys = new Set<string>()
    for (const tool of tools) {
      const key = shankKey(tool.geometry.shankDiameter)
      if (key !== undefined) keys.add(key)
    }
    return [...keys].sort((a, b) => Number(a) - Number(b))
  }, [tools])
  const columnFilters = useMemo(() => {
    const filters: ColumnFiltersState = []
    if (filter.type.by === "kind")
      filters.push({ id: "kind", value: filter.type.kind })
    if (filter.type.by === "recommended")
      filters.push({ id: "recommended", value: true })
    if (filter.shank !== ALL_SHANKS)
      filters.push({ id: "shankSize", value: filter.shank })
    if (filter.catalog !== ALL_CATALOGS)
      filters.push({ id: "catalog", value: filter.catalog })
    return filters
  }, [filter.type, filter.shank, filter.catalog])
  const rowSelection = useMemo<RowSelectionState>(
    () => (editingId === null ? {} : { [editingId]: true }),
    [editingId]
  )
  const table = useTable({
    features: toolTableFeatures,
    columns,
    data,
    getRowId: (row) => row.tool.id,
    initialState: {
      sorting: [{ id: "name", desc: false }],
      columnVisibility: FILTER_COLUMNS,
    },
    state: { globalFilter: filter.query, columnFilters, rowSelection },
    globalFilterFn: filterFn_includesString,
    getColumnCanGlobalFilter: (candidate) => candidate.id === "search",
    enableMultiSort: false,
    enableSortingRemoval: false,
    sortDescFirst: false,
    enableMultiRowSelection: false,
    onRowSelectionChange: (updater) => {
      const [id] = Object.keys(functionalUpdate(updater, rowSelection))
      const row = data.find((entry) => entry.tool.id === id)
      if (row && id !== editingId) onEditTool(row.tool)
    },
    meta: { inUseId, disabled },
  })
  return {
    table,
    filter,
    kinds,
    /** The shank diameters among the tools, smallest first, as shankKey writes them. */
    shanks,
    /** The caller recommends types, so the type filter offers "Recommended". */
    recommends: recommendation !== null,
    changeFilter: (change: Partial<ToolFilter>) =>
      setFilter((current) => ({ ...current, ...change })),
    /** Show the user's own tools unfiltered, e.g. after adding one. */
    revealMyTools: () => setFilter({ ...INITIAL_FILTER, catalog: MY_TOOLS }),
  }
}
export type ToolTableController = ReturnType<typeof useToolTable>

export function ToolCatalogSelect({
  controller,
  catalogs,
  disabled,
}: {
  controller: ToolTableController
  catalogs: readonly LoadedToolCatalog[]
  disabled: boolean
}) {
  const id = useId()
  const options = [
    { value: ALL_CATALOGS, label: "All catalogs" },
    ...catalogs.map((catalog) => ({ value: catalog.id, label: catalog.name })),
    { value: MY_TOOLS, label: "My tools" },
  ]
  return (
    <Field
      orientation="horizontal"
      className="w-auto min-w-0 flex-wrap"
      data-disabled={disabled}
    >
      <FieldLabel htmlFor={id}>Catalog</FieldLabel>
      <OptionSelect
        id={id}
        aria-label="Browse tool catalog"
        className="w-44 shrink-0"
        options={options}
        value={controller.filter.catalog}
        disabled={disabled}
        onValueChange={(catalog) => controller.changeFilter({ catalog })}
      />
    </Field>
  )
}

export function ToolSearch({
  controller,
}: {
  controller: ToolTableController
}) {
  const { filter, kinds, shanks, recommends, changeFilter } = controller
  const types: ToolTypeFilter[] = [
    ...(recommends ? [RECOMMENDED_TYPES] : []),
    ALL_TYPES,
    ...kinds.map((kind): ToolTypeFilter => ({ by: "kind", kind })),
  ]
  const options = types.map((type) => ({
    value: typeFilterValue(type),
    label: typeFilterLabel(type),
  }))
  const shankOptions = [
    { value: ALL_SHANKS, label: "All shanks" },
    ...shanks.map((key) => ({
      value: key,
      label: formatShankDiameter(Number(key)),
    })),
  ]
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_130px_130px] gap-2 p-3">
      <InputGroup>
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search tools"
          placeholder="Name, vendor or ID"
          value={filter.query}
          onChange={(event) => changeFilter({ query: event.target.value })}
        />
      </InputGroup>
      <OptionSelect
        aria-label="Filter tool type"
        className="w-full min-w-0"
        options={options}
        value={typeFilterValue(filter.type)}
        onValueChange={(value) =>
          changeFilter({ type: typeFilterFromValue(value) })
        }
      />
      <OptionSelect
        numeric
        aria-label="Filter shank diameter"
        className="w-full min-w-0"
        options={shankOptions}
        value={filter.shank}
        onValueChange={(shank) => changeFilter({ shank })}
      />
    </div>
  )
}

const SORT_ICONS = { asc: ArrowUp, desc: ArrowDown } as const
const ARIA_SORT = { asc: "ascending", desc: "descending" } as const

function ColumnHead({
  header,
  table,
}: {
  header: Header<Features, ToolRow>
  table: ToolTableInstance
}) {
  const sorted = header.column.getIsSorted()
  const SortIcon = sorted ? SORT_ICONS[sorted] : null
  return (
    <TableHead
      className={header.column.columnDef.meta?.headClassName}
      aria-sort={sorted ? ARIA_SORT[sorted] : undefined}
    >
      {header.column.getCanSort() ? (
        <Button
          variant="ghost"
          onClick={header.column.getToggleSortingHandler()}
        >
          <table.FlexRender header={header} />
          {SortIcon && <SortIcon data-icon="inline-end" />}
        </Button>
      ) : (
        <table.FlexRender header={header} />
      )}
    </TableHead>
  )
}

/** Stands in for the rows scrolled out of view, keeping the scroll height. */
function SpacerRow({ height, colSpan }: { height: number; colSpan: number }) {
  if (height <= 0) return null
  return (
    <tr aria-hidden="true">
      <td colSpan={colSpan} style={{ height }} />
    </tr>
  )
}

const ROW_HEIGHT_ESTIMATE = 72

/** The filtered, sorted tools; only rows near the viewport are rendered. */
export function ToolTable({
  table,
  libraryEmpty,
}: {
  table: ToolTableInstance
  libraryEmpty: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { rows } = table.getRowModel()
  const getItemKey = useCallback((index: number) => rows[index].id, [rows])
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    getItemKey,
    overscan: 8,
  })
  const items = virtualizer.getVirtualItems()
  const first = items.at(0)
  const last = items.at(-1)
  const columnCount = table.getVisibleLeafColumns().length
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <ColumnHead key={header.id} header={header} table={table} />
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {first && <SpacerRow height={first.start} colSpan={columnCount} />}
          {items.map((item) => {
            const row = rows[item.index]
            return (
              <TableRow
                key={row.id}
                ref={virtualizer.measureElement}
                data-index={item.index}
                data-state={row.getIsSelected() ? "selected" : undefined}
                onClick={() => row.toggleSelected(true)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.columnDef.meta?.cellClassName}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
          {last && (
            <SpacerRow
              height={virtualizer.getTotalSize() - last.end}
              colSpan={columnCount}
            />
          )}
        </TableBody>
      </Table>
      {!rows.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {libraryEmpty ? "No tools in this library" : "No matching tools"}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
