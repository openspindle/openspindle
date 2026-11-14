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
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { useFixtureLibrary } from "@/app/fixtures/fixture-context"
import { WORKSPACE_PROFILE, bedSetupOf } from "@/domain/fixtures/profiles"
import { sameFixtureFamily } from "@/domain/fixtures/fixture-catalog"
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
import { bedAnchors } from "@/domain/anchors/stored-anchors"
import type { PointIntent } from "../point-intent"

const isMoveAxes = (value: unknown): value is MoveAxes =>
  MOVE_AXES.some((axes) => axes === value)

/**
 * The shared definition's editor with the plate's bed setup as its default-placement context.
 * Legacy snapshots match by intrinsic identity when migration reassigned a duplicate id.
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
  const matches = (definition: (typeof library.definitions)[number]) =>
    sameFixtureFamily(definition, instance.definition)
  const definition =
    library.definitions.find(
      (candidate) =>
        candidate.id === instance.definition.id && matches(candidate)
    ) ?? library.definitions.find(matches)
  if (!definition) return null
  return {
    kind: "fixture-definition",
    profileId,
    bedSetupId: bedSetup.id,
    definitionId: definition.id,
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
  const picked = request?.point
  const pickedPlate = workspace.state.plates.find(
    (plate) => plate.id === picked?.plateId
  )
  const openPoint = (action: PointIntent["action"]) => {
    if (!picked || !pickedPlate) return
    openDialog({
      kind: "point-actions",
      intent: {
        id: crypto.randomUUID(),
        plateId: pickedPlate.id,
        position: picked.position,
        setup: pickedPlate.setup,
        action,
      },
    })
  }
  const moveStock = (anchorId: string) => {
    if (
      !picked ||
      !pickedPlate ||
      picked.item.kind !== "stock" ||
      !picked.setupPoint
    )
      return
    const destination = bedAnchors(pickedPlate.setup.anchors ?? undefined).find(
      (entry) => entry.id === anchorId
    )
    if (!destination) return
    const result = workspace.dispatch({
      type: "batch",
      commands: [
        {
          type: "plate.moveItem",
          plateId: pickedPlate.id,
          item: { kind: "stock" },
          delta: [
            destination.position[0] - picked.position[0],
            destination.position[1] - picked.position[1],
            0,
          ],
        },
        {
          type: "plate.setup",
          plateId: pickedPlate.id,
          patch: { stockRelativeTo: destination.id },
        },
      ],
    })
    if (!result.ok) toast.error(result.error)
  }
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
        {picked && pickedPlate && (
          <>
            {moving && picked.item.kind === "stock" && picked.setupPoint && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  Move stock point to
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {bedAnchors(pickedPlate.setup.anchors ?? undefined).map(
                    (entry) => (
                      <ContextMenuItem
                        key={entry.id}
                        onClick={() => moveStock(entry.id)}
                      >
                        {entry.name}
                      </ContextMenuItem>
                    )
                  )}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            {!moving && (
              <ContextMenuItem onClick={() => openPoint("probe")}>
                Probe at point…
              </ContextMenuItem>
            )}
            <ContextMenuSub>
              <ContextMenuSubTrigger>Jog to point</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem onClick={() => openPoint("xy")}>
                  X / Y · retract Z first…
                </ContextMenuItem>
                <ContextMenuItem onClick={() => openPoint("z")}>
                  Z · 5 mm above modeled surface…
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuSeparator />
          </>
        )}
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
