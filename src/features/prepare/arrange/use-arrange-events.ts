import { toast } from "sonner"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import type { WorkspaceStore } from "@/app/workspace/store"
import type {
  ArrangeEvents,
  ArrangeMenuRequest,
  ArrangePick,
} from "@/components/workspace/bed-viewer"
import type { Plate } from "@/domain/plate/plate"
import { setupItem } from "@/domain/plate/setup-items"
import type { SetupItem, SetupItemRef } from "@/domain/plate/setup-items"
import type { PrepareSearch } from "@/routes/_workspace/prepare"
import { usePrepareSelection } from "../plate-tree/use-prepare-selection"
import { withPickedEdge, withPickedStart } from "@/domain/probing/picked-start"
import {
  currentPicking,
  dragAtom,
  isArrangeSelection,
  selectSetupItem,
  setMoving,
  setPicking,
} from "./arrange-state"

/** The inspector panel with an item's settings; undefined keeps the panel shown. */
function panelOf(item: SetupItemRef): PrepareSearch["panel"] {
  switch (item.kind) {
    case "fixture":
      return "fixtures"
    case "stock":
    case "design":
      return "setup"
    case "bed":
      return undefined
  }
}

/** What a fixture's lock control needs of the item it locks or unlocks. */
type LockTarget = { plate: Plate; item: Pick<SetupItem, "ref" | "locked"> }

/** What a lock control says: the same wording wherever a fixture can be locked or unlocked. */
export function lockToggleCopy(locked: boolean) {
  return {
    label: locked ? "Unlock" : "Lock",
    description: locked ? "Let it move again." : "Keep it in place.",
  }
}

/**
 * Locks or unlocks a fixture; locking ends move mode when the fixture was the one selected and
 * moving.
 */
export function toggleLock(workspace: WorkspaceStore, target: LockTarget) {
  const { plate, item } = target
  if (item.ref.kind !== "fixture" || item.locked === null) return
  const locked = !item.locked
  const result = workspace.dispatch({
    type: "fixture.lock",
    plateId: plate.id,
    fixtureId: item.ref.id,
    locked,
  })
  if (!result.ok) toast.error(result.error)
  else if (locked && isArrangeSelection(plate.id, item.ref)) setMoving(false)
}

/**
 * Selects a plate's setup item as clicking it in the viewer does, and the inspector shows its
 * settings; no item selects the plate alone.
 */
export function useSelectSetupItem() {
  const workspace = useWorkspaceStore()
  const selection = usePrepareSelection()
  return (plateId: string | null, item: SetupItemRef | null) => {
    const plate = workspace.state.plates.find(({ id }) => id === plateId)
    if (!plate || !item) {
      selectSetupItem(null)
      if (plate) selection.selectPlate(plate.id)
      return
    }
    const movable = !setupItem(plate.setup, item)?.fixed
    selectSetupItem({ plateId: plate.id, item }, movable)
    const panel = panelOf(item)
    // The machine bed has no settings of its own: what the inspector shows stays.
    if (panel) selection.showPlateSetup(plate.id, panel)
    else if (workspace.state.selectedPlateId !== plate.id)
      selection.selectPlate(plate.id)
  }
}

/**
 * What the Prepare viewer does when setup items are clicked and moved: the inspector shows the
 * selected item's settings, and moves are workspace commands.
 */
export function useArrangeEvents(handlers: {
  menu: (request: ArrangeMenuRequest) => void
  pick: (pick: ArrangePick) => void
}): ArrangeEvents {
  const workspace = useWorkspaceStore()
  const select = useSelectSetupItem()
  return {
    select,
    move: (plateId, item, delta) => {
      const result = workspace.dispatch({
        type: "plate.moveItem",
        plateId,
        item,
        delta,
      })
      if (!result.ok) toast.error(result.error)
      return result.ok
    },
    menu: handlers.menu,
    pick: handlers.pick,
    drag: (drag) => dragAtom.set(() => drag),
    pickPoint: (plateId, pick) => {
      const picked = pickedOperation(workspace, plateId, "point")
      if (!picked) return
      const { plate, operation } = picked
      const source =
        operation.source.kind === "probing"
          ? withPickedStart(operation.source, plate, pick.position, pick.target)
          : null
      if (!source) {
        toast.error(
          "The plate has no anchors to start from: read the device's anchors."
        )
        return
      }
      const result = workspace.dispatch({
        type: "operation.source",
        plateId,
        operationId: operation.id,
        source,
        expectedRevision: operation.revision,
      })
      if (!result.ok) toast.error(result.error)
      setPicking(null)
    },
    pickEdge: (plateId, edge) => {
      const picked = pickedOperation(workspace, plateId, "edges")
      if (!picked) return
      const { operation } = picked
      const source =
        operation.source.kind === "probing"
          ? withPickedEdge(operation.source, edge)
          : null
      if (!source) {
        toast.error("The trace follows as many edges as it can.")
        return
      }
      const result = workspace.dispatch({
        type: "operation.source",
        plateId,
        operationId: operation.id,
        source,
        expectedRevision: operation.revision,
      })
      if (!result.ok) toast.error(result.error)
    },
  }
}

/**
 * The operation a pick is for, as the workspace has it now; null, and picking ends, when it is
 * gone or another pick is under way.
 */
function pickedOperation(
  workspace: WorkspaceStore,
  plateId: string,
  kind: "point" | "edges"
) {
  const picking = currentPicking()
  if (!picking || picking.kind !== kind || picking.plateId !== plateId)
    return null
  const plate = workspace.state.plates.find(({ id }) => id === plateId)
  const operation = plate?.operations.find(
    ({ id }) => id === picking.operationId
  )
  if (!plate || !operation) {
    setPicking(null)
    return null
  }
  return { plate, operation }
}
