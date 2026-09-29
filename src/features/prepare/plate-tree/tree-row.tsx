import { useState } from "react"
import type { ComponentProps, MouseEvent, ReactNode } from "react"
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileCode2,
  Folder,
  FolderOpen,
  LandPlot,
  Layers3,
  ListTree,
  Pause,
  PencilLine,
  Plus,
  SquareDashed,
  Ungroup,
  Wrench,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { InlineNameInput } from "@/components/workspace/inline-name-input"
import { SidebarMenuSubButton } from "@/components/ui/sidebar"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import type { StepId } from "@/app/workspace/history"
import type { WorkspaceStore } from "@/app/workspace/store"
import type { SectionKind } from "@/domain/compile/sections"
import type { Operation } from "@/domain/operations/operation"
import { plateLabel } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import { TEXT_LIMIT } from "@/domain/primitives"
import { boundTools } from "@/domain/tools/tool-table"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import { useFusionUpdate } from "@/features/fusion360/use-fusion-update"
import { useOperationIcon } from "@/features/plugins/operation-icon"
import { openDialog } from "@/features/shell/dialogs"
import { isPluginUsable } from "@/platform/contract/plugin-rpc"
import { useInstalledPlugins } from "@/platform/plugins"
import { useQuickFix } from "../quick-fix"
import { selectSections } from "../selection"
import { toggleOperationHidden, useHiddenOperations } from "../visibility"
import type { TreeRow } from "./tree-rows"
import type { TreeTableRow } from "./plate-tree"

const INDENT = ["pl-1", "pl-5", "pl-9", "pl-12"] as const

const SECTION_ICONS: Partial<Record<SectionKind, LucideIcon>> = {
  "tool-change": Wrench,
  probe: LandPlot,
  "touch-off": ArrowDownToLine,
  scan: SquareDashed,
  pause: Pause,
}

type RowProps = {
  row: TreeTableRow
  selectedPlateId: string | null
  selectedOperationId: string | null
  onToggle: () => void
  onSelectPlate: (plateId: string) => void
  onSelectOperation: (plateId: string, operationId: string) => void
  onSelectSection: (event: MouseEvent) => void
}

/** A row of the tree; it takes a div's props, so a context menu can open on it. */
function RowFrame({
  row,
  selected,
  className,
  ...props
}: ComponentProps<"div"> & {
  row: TreeTableRow
  selected: boolean
}) {
  return (
    <div
      {...props}
      className={cn(
        "flex h-full items-center gap-1 rounded-md pr-1",
        INDENT[Math.min(row.depth, INDENT.length - 1)],
        className
      )}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={selected}
      aria-expanded={row.getCanExpand() ? row.getIsExpanded() : undefined}
    />
  )
}

function ExpandButton({
  row,
  onToggle,
}: {
  row: TreeTableRow
  onToggle: () => void
}) {
  if (!row.getCanExpand()) return <span className="size-7 shrink-0" />
  const expanded = row.getIsExpanded()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`${expanded ? "Collapse" : "Expand"} ${row.original.label}`}
      onClick={onToggle}
    >
      {expanded ? <ChevronDown /> : <ChevronRight />}
    </Button>
  )
}

function RowButton({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean
  title?: string
  onClick: (event: MouseEvent) => void
  children: ReactNode
}) {
  return (
    <SidebarMenuSubButton
      render={<button type="button" />}
      isActive={active}
      className="min-w-0 flex-1 translate-x-0 px-1"
      title={title}
      onClick={onClick}
    >
      {children}
    </SidebarMenuSubButton>
  )
}

function IconAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function ErrorCount({ count }: { count: number }) {
  if (!count) return null
  return (
    <Badge
      variant="destructive"
      className="font-numeric"
      title={`${count} problems block Run`}
    >
      {count}
    </Badge>
  )
}

/**
 * Says what the change just made did, with Undo while its step is the latest; after later
 * changes, Edit › Undo steps back to it. `previous` is the step that was the latest before it.
 * `onUndo` runs after Undo actually restores the step, for a side effect such as following the
 * change back (`WorkspaceStore.undo` does not move the selection itself).
 */
function toastUndoable(
  workspace: WorkspaceStore,
  previous: StepId | null,
  message: string,
  onUndo?: () => void
) {
  const step = workspace.history.latestStep
  // A change that made no step of its own has nothing to undo here.
  if (step === null || (previous !== null && step <= previous)) {
    toast(message)
    return
  }
  toast(message, {
    action: {
      label: "Undo",
      onClick: () => {
        if (workspace.undo(step)) onUndo?.()
        else if (workspace.history.holds(step))
          toast.info(
            "Newer changes follow this one. Undo them first with Edit › Undo."
          )
      },
    },
  })
}

function PlateRow(
  props: RowProps & { node: Extract<TreeRow, { kind: "plate" }> }
) {
  const workspace = useWorkspaceStore()
  const { node, row } = props
  const active =
    props.selectedPlateId === node.plate.id &&
    props.selectedOperationId === null
  const neighbor = (offset: number) =>
    workspace.state.plates.at(node.index + offset)
  const move = (offset: number) => {
    const target = neighbor(offset)
    if (target && node.index + offset >= 0)
      workspace.dispatch({
        type: "plate.move",
        plateId: node.plate.id,
        targetId: target.id,
      })
  }
  const remove = () => {
    const previous = workspace.history.latestStep
    if (workspace.dispatch({ type: "plate.remove", plateId: node.plate.id }).ok)
      toastUndoable(workspace, previous, `Removed ${node.label}.`)
  }
  return (
    <RowFrame row={row} selected={active}>
      <ExpandButton row={row} onToggle={props.onToggle} />
      <RowButton
        active={active}
        title={node.label}
        onClick={() => props.onSelectPlate(node.plate.id)}
      >
        <Layers3 />
        <span className="truncate">{node.label}</span>
      </RowButton>
      <ErrorCount count={node.errors} />
      <IconAction
        label={`Add operation to ${node.label}`}
        onClick={() => {
          props.onSelectPlate(node.plate.id)
          openDialog({ kind: "add-operation" })
        }}
      >
        <Plus />
      </IconAction>
      <IconAction
        label={`Move ${node.label} up`}
        disabled={node.index === 0}
        onClick={() => move(-1)}
      >
        <ArrowUp />
      </IconAction>
      <IconAction
        label={`Move ${node.label} down`}
        disabled={!neighbor(1)}
        onClick={() => move(1)}
      >
        <ArrowDown />
      </IconAction>
      <IconAction label={`Remove ${node.label}`} onClick={remove}>
        <X />
      </IconAction>
    </RowFrame>
  )
}

/**
 * Moves an operation to another plate in one change, to its end or to `index`. Its tools go
 * along as the library tools they are, numbered in that plate's own tool table.
 */
function transferCommand(
  plates: readonly Plate[],
  fromPlateId: string,
  operationId: string,
  toPlateId: string,
  index?: number
): WorkspaceCommand | null {
  const from = plates.find((plate) => plate.id === fromPlateId)
  const operation = from?.operations.find((item) => item.id === operationId)
  if (!from || !operation || from.id === toPlateId) return null
  return {
    type: "batch",
    commands: [
      { type: "operation.remove", plateId: from.id, operationId },
      {
        type: "operation.add",
        plateId: toPlateId,
        operation: { ...operation, tools: [] },
        preferredTools: boundTools(from, operation),
        index,
      },
    ],
  }
}

/**
 * Brings an operation up to date from where it came from: a Fusion 360 NC program posted
 * again, or a plugin program generated again by the newer version of its plugin installed.
 * Nothing for an operation with nowhere to update from.
 */
function UpdateItems({
  plate,
  operation,
}: {
  plate: Plate
  operation: Operation
}) {
  const fusionUpdate = useFusionUpdate()
  const quickFix = useQuickFix()
  const plugins = useInstalledPlugins().data ?? []
  const { source } = operation
  const fromFusion = source.kind === "file" && source.origin !== undefined
  const plugin =
    source.kind === "template"
      ? plugins.find((item) => item.id === source.pluginId)
      : undefined
  const newer =
    source.kind === "template" &&
    plugin &&
    isPluginUsable(plugin) &&
    plugin.version !== source.version
      ? plugin
      : null
  if (!fromFusion && !newer) return null
  return (
    <>
      {fromFusion && (
        <ContextMenuItem
          disabled={fusionUpdate.isPending}
          onClick={() =>
            fusionUpdate.mutate({
              plateId: plate.id,
              operationId: operation.id,
            })
          }
        >
          Update from Fusion 360
        </ContextMenuItem>
      )}
      {newer && (
        <ContextMenuItem
          onClick={() =>
            quickFix(plate, {
              kind: "update-operation",
              operationId: operation.id,
            })
          }
        >
          Update to {newer.manifest.name} {newer.version}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
    </>
  )
}

/**
 * An operation's context menu: update it from where it came from, move it to another plate, or
 * remove it.
 */
function OperationMenu({
  plate,
  operation,
  onMove,
  onRemove,
}: {
  plate: Plate
  operation: Operation
  onMove: (plateId: string) => void
  onRemove: () => void
}) {
  const plates = useWorkspace((state) => state.plates)
  const plateId = plate.id
  return (
    <>
      <UpdateItems plate={plate} operation={operation} />
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={plates.length < 2}>
          Move to
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {plates.map((target, index) => (
            <ContextMenuItem
              key={target.id}
              disabled={target.id === plateId}
              onClick={() => onMove(target.id)}
            >
              {plateLabel(target, index)}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onRemove}>Remove</ContextMenuItem>
    </>
  )
}

function OperationRow(
  props: RowProps & { node: Extract<TreeRow, { kind: "operation" }> }
) {
  const workspace = useWorkspaceStore()
  const { node, row } = props
  const { plate, operation } = node
  const iconOf = useOperationIcon()
  const Icon = iconOf(operation)
  const hidden = useHiddenOperations().has(operation.id)
  const active = props.selectedOperationId === operation.id
  const move = (index: number) =>
    workspace.dispatch({
      type: "operation.move",
      plateId: plate.id,
      operationId: operation.id,
      index,
    })
  const remove = () => {
    const previous = workspace.history.latestStep
    const removed = workspace.dispatch({
      type: "operation.remove",
      plateId: plate.id,
      operationId: operation.id,
    })
    if (removed.ok) toastUndoable(workspace, previous, `Removed ${node.label}.`)
  }
  const moveTo = (targetId: string) => {
    const { plates } = workspace.state
    const target = plates.findIndex((item) => item.id === targetId)
    const command = transferCommand(plates, plate.id, operation.id, targetId)
    if (target < 0 || !command) return
    const previous = workspace.history.latestStep
    const moved = workspace.dispatch(command)
    if (!moved.ok) {
      toast.error(moved.error)
      return
    }
    // The inspector shows operations of the selected plate: a selected operation is followed.
    if (active) props.onSelectOperation(targetId, operation.id)
    toastUndoable(
      workspace,
      previous,
      `Moved ${node.label} to ${plateLabel(plates[target], target)}.`,
      () => {
        // Undo puts the operation back on its own plate: follow it there too.
        if (active && workspace.state.selectedPlateId === targetId)
          props.onSelectOperation(plate.id, operation.id)
      }
    )
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="data-popup-open:bg-sidebar-accent"
        render={<RowFrame row={row} selected={active} />}
      >
        <ExpandButton row={row} onToggle={props.onToggle} />
        <IconAction
          label={`${hidden ? "Show" : "Hide"} ${node.label} in the 3D view`}
          onClick={() => toggleOperationHidden(operation.id)}
        >
          {hidden ? <EyeOff /> : <Eye />}
        </IconAction>
        <RowButton
          active={active}
          title={operation.name}
          onClick={() => props.onSelectOperation(plate.id, operation.id)}
        >
          <Icon />
          <span className="truncate">{node.label}</span>
        </RowButton>
        <ErrorCount count={node.errors} />
        <IconAction
          label={`Move ${node.label} up`}
          disabled={node.index === 0}
          onClick={() => move(node.index - 1)}
        >
          <ArrowUp />
        </IconAction>
        <IconAction
          label={`Move ${node.label} down`}
          disabled={node.index === node.count - 1}
          onClick={() => move(node.index + 1)}
        >
          <ArrowDown />
        </IconAction>
        <IconAction
          label={`View source of ${node.label}`}
          onClick={() =>
            openDialog({
              kind: "source",
              plateId: plate.id,
              operationId: operation.id,
            })
          }
        >
          <FileCode2 />
        </IconAction>
        <IconAction label={`Remove ${node.label}`} onClick={remove}>
          <X />
        </IconAction>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <OperationMenu
          plate={plate}
          operation={operation}
          onMove={moveTo}
          onRemove={remove}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function GroupRow(
  props: RowProps & { node: Extract<TreeRow, { kind: "group" }> }
) {
  const workspace = useWorkspaceStore()
  const [editing, setEditing] = useState(false)
  const { node, row } = props
  const { plate, group } = node
  const setGroups = (
    update: (groups: typeof plate.groups) => typeof plate.groups
  ) => {
    const current = workspace.state.plates.find((item) => item.id === plate.id)
    if (current)
      workspace.dispatch({
        type: "groups.set",
        plateId: plate.id,
        groups: update(current.groups),
      })
  }
  // Selects the group's sections, as selecting them one by one would.
  const selectGroup = () => {
    const sections = row.subRows.filter(
      (sub) => sub.original.kind === "section"
    )
    const first = sections.at(0)?.original
    if (first?.kind !== "section") return
    props.onSelectOperation(plate.id, first.section.operationId)
    selectSections(sections.map((sub) => sub.id))
  }
  const Icon = row.getIsExpanded() ? FolderOpen : Folder
  return (
    <RowFrame row={row} selected={false}>
      <ExpandButton row={row} onToggle={props.onToggle} />
      {editing ? (
        <InlineNameInput
          name={group.name}
          label="Group name"
          maxLength={TEXT_LIMIT}
          onSave={(name) =>
            setGroups((groups) =>
              groups.map((item) =>
                item.id === group.id ? { ...item, name } : item
              )
            )
          }
          onDone={() => setEditing(false)}
        />
      ) : (
        <RowButton
          active={false}
          title="Double-click to rename"
          onClick={selectGroup}
        >
          <Icon />
          <span className="truncate" onDoubleClick={() => setEditing(true)}>
            {group.name}
          </span>
        </RowButton>
      )}
      <IconAction
        label={`Rename ${group.name}`}
        onClick={() => setEditing(true)}
      >
        <PencilLine />
      </IconAction>
      <IconAction
        label={`Ungroup ${group.name}`}
        onClick={() =>
          setGroups((groups) => groups.filter((item) => item.id !== group.id))
        }
      >
        <Ungroup />
      </IconAction>
    </RowFrame>
  )
}

function SectionRow(
  props: RowProps & { node: Extract<TreeRow, { kind: "section" }> }
) {
  const { node, row } = props
  const { section } = node
  const selected = row.getIsSelected()
  const Icon = SECTION_ICONS[section.kind] ?? ListTree
  return (
    <RowFrame row={row} selected={selected}>
      <span className="size-7 shrink-0" />
      <RowButton
        active={selected}
        title={`${section.name} · Lines ${section.startLine}–${section.endLine}`}
        onClick={props.onSelectSection}
      >
        <Icon />
        <span className="truncate">{node.label}</span>
      </RowButton>
      {section.tool !== null && (
        <Badge variant="secondary" className="font-numeric">
          T{section.tool}
        </Badge>
      )}
      <Checkbox
        aria-label={`Select ${section.name} at line ${section.startLine}`}
        checked={selected}
        onCheckedChange={() => row.toggleSelected()}
      />
    </RowFrame>
  )
}

export function TreeRowView(props: RowProps) {
  const node = props.row.original
  switch (node.kind) {
    case "plate":
      return <PlateRow {...props} node={node} />
    case "operation":
      return <OperationRow {...props} node={node} />
    case "group":
      return <GroupRow {...props} node={node} />
    case "section":
      return <SectionRow {...props} node={node} />
  }
}
