import { useMemo } from "react"
import { toast } from "sonner"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/context-menu"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { useFixtureLibrary } from "@/app/fixtures/fixture-context"
import { WORKSPACE_PROFILE, bedSetupOf } from "@/domain/fixtures/profiles"
import type { FixtureLibrary } from "@/persistence/fixture-document"
import { openDialog } from "@/features/shell/dialogs"
import type { WorkspaceDialog } from "@/features/shell/dialogs"
import type { ArrangeMenuRequest } from "@/components/workspace/bed-viewer"
import {
  MOVE_AXES,
  MOVE_AXES_LABELS,
  alignment,
} from "@/domain/plate/setup-items"
import type { MoveAxes } from "@/domain/plate/setup-items"
import { setMoveAxes, setMoving, setSnap, useArrange } from "./arrange-state"
import type { ArrangeTarget } from "./arrange-state"
import { toggleLock } from "./use-arrange-events"

const isMoveAxes = (value: unknown): value is MoveAxes =>
  MOVE_AXES.some((axes) => axes === value)

/**
 * The dialog that edits a fixture's definition, as its plate's device's bed setup defines it;
 * null for other items, and for a fixture that bed setup does not define.
 */
function fixtureDialog(
  { plate, item }: ArrangeTarget,
  library: FixtureLibrary
): WorkspaceDialog | null {
  if (item.ref.kind !== "fixture") return null
  const { id } = item.ref
  const instance = plate.setup.fixtures.find((fixture) => fixture.id === id)
  const profileId = plate.setup.deviceId ?? WORKSPACE_PROFILE
  if (!instance || !Object.hasOwn(library.profiles, profileId)) return null
  const bedSetup = bedSetupOf(
    library.profiles[profileId],
    plate.setup.bedSetupId
  )
  const definitionId = instance.definition.id
  if (
    !bedSetup.definitions.some((definition) => definition.id === definitionId)
  )
    return null
  return {
    kind: "fixture-definition",
    profileId,
    bedSetupId: bedSetup.id,
    definitionId,
  }
}

const AXIS_SHORTCUTS: Partial<Record<MoveAxes, string>> = {
  x: "X",
  y: "Y",
  z: "Z",
}

/**
 * The viewer's context menu: move and lock the selected item, the axes moves keep to and
 * snapping; with a point of the moving item picked, aligning it to the right-clicked point.
 */
export function ArrangeMenu({
  request,
  target,
  onClose,
}: {
  request: ArrangeMenuRequest | null
  target: ArrangeTarget | null
  onClose: () => void
}) {
  const workspace = useWorkspaceStore()
  const { moving, axes, snap } = useArrange()
  const library = useFixtureLibrary((state) => state)
  const editing = target && fixtureDialog(target, library)
  const anchor = useMemo(
    () =>
      request && {
        getBoundingClientRect: () =>
          DOMRect.fromRect({ x: request.x, y: request.y, width: 0, height: 0 }),
      },
    [request]
  )
  const offered = request?.alignment
  const align = (along: MoveAxes) => {
    if (!target || !offered) return
    const result = workspace.dispatch({
      type: "plate.moveItem",
      plateId: target.plate.id,
      item: target.item.ref,
      delta: alignment(offered.from.position, offered.to.position, along),
    })
    if (!result.ok) toast.error(result.error)
  }
  return (
    <ContextMenu
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ContextMenuContent anchor={anchor} className="w-60">
        {target && (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel>{target.item.name}</ContextMenuLabel>
              <ContextMenuCheckboxItem
                checked={moving && !target.item.fixed}
                disabled={!!target.item.fixed}
                onCheckedChange={setMoving}
              >
                Move
                <ContextMenuShortcut>M</ContextMenuShortcut>
              </ContextMenuCheckboxItem>
              {target.item.locked !== null && (
                <ContextMenuCheckboxItem
                  checked={target.item.locked}
                  onCheckedChange={() => toggleLock(workspace, target)}
                >
                  Locked
                  <ContextMenuShortcut>L</ContextMenuShortcut>
                </ContextMenuCheckboxItem>
              )}
              {editing && (
                <ContextMenuItem onClick={() => openDialog(editing)}>
                  Edit fixture…
                </ContextMenuItem>
              )}
            </ContextMenuGroup>
            <ContextMenuSeparator />
          </>
        )}
        {target && offered && (
          <>
            <ContextMenuGroup>
              <ContextMenuLabel>
                Align {offered.from.label} to {offered.to.label}, along
              </ContextMenuLabel>
              {MOVE_AXES.map((along) => (
                <ContextMenuItem key={along} onClick={() => align(along)}>
                  {MOVE_AXES_LABELS[along]}
                </ContextMenuItem>
              ))}
            </ContextMenuGroup>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuGroup>
          <ContextMenuLabel>Move along</ContextMenuLabel>
          <ContextMenuRadioGroup
            value={axes}
            onValueChange={(value) => {
              if (isMoveAxes(value)) setMoveAxes(value)
            }}
          >
            {MOVE_AXES.map((value) => (
              <ContextMenuRadioItem key={value} value={value}>
                {MOVE_AXES_LABELS[value]}
                {AXIS_SHORTCUTS[value] && (
                  <ContextMenuShortcut>
                    {AXIS_SHORTCUTS[value]}
                  </ContextMenuShortcut>
                )}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuCheckboxItem checked={snap} onCheckedChange={setSnap}>
          Snap to points
        </ContextMenuCheckboxItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
