import { useMemo } from "react"
import { createAtom, useSelector } from "@tanstack/react-store"
import { useSelectedPlate } from "@/app/workspace/workspace-context"
import type {
  ArrangeDrag,
  ArrangeSelection,
} from "@/components/workspace/bed-viewer"
import type { Plate } from "@/domain/plate/plate"
import { sameSetupItem, setupItem } from "@/domain/plate/setup-items"
import type {
  MoveAxes,
  SetupItem,
  SetupItemRef,
} from "@/domain/plate/setup-items"

/** Picking in the viewer for an operation: a point to start it at, or edges for it to trace. */
export type OperationPicking = {
  readonly kind: "point" | "edges"
  readonly plateId: string
  readonly operationId: string
}

/** The setup item selected in the Prepare viewer, move mode and how moves go. */
export type ArrangeState = {
  readonly selection: ArrangeSelection | null
  /** Move mode as asked for; it is in effect while the selected item can move. */
  readonly moving: boolean
  readonly axes: MoveAxes
  /** Whether drags snap the item's points to other points. */
  readonly snap: boolean
  /** Picking for an operation, which clicks then do instead of selecting. */
  readonly picking: OperationPicking | null
}

const arrangeAtom = createAtom<ArrangeState>({
  selection: null,
  moving: false,
  axes: "xy",
  snap: true,
  picking: null,
})

/** How far a drag has moved its item, while it lasts. */
export const dragAtom = createAtom<ArrangeDrag | null>(null)

export const useArrange = () => useSelector(arrangeAtom)
export const useArrangeDrag = () => useSelector(dragAtom)
export const useArrangeSelection = () =>
  useSelector(arrangeAtom, (state) => state.selection)

/** Selects an item; move mode carries over only to an item that can move too. */
export function selectSetupItem(
  selection: ArrangeSelection | null,
  movable = false
) {
  arrangeAtom.set((state) => ({
    ...state,
    selection,
    moving: state.moving && movable,
  }))
}

export const setMoving = (moving: boolean) =>
  arrangeAtom.set((state) => ({ ...state, moving }))
export const setMoveAxes = (axes: MoveAxes) =>
  arrangeAtom.set((state) => ({ ...state, axes }))
export const setSnap = (snap: boolean) =>
  arrangeAtom.set((state) => ({ ...state, snap }))

/** Starts picking for an operation, which ends move mode, or ends picking (null). */
export const setPicking = (picking: OperationPicking | null) =>
  arrangeAtom.set((state) => ({
    ...state,
    picking,
    moving: picking ? false : state.moving,
  }))

export const usePicking = () =>
  useSelector(arrangeAtom, (state) => state.picking)

/** The picking under way, read outside a component. */
export const currentPicking = () => arrangeAtom.get().picking

/** Whether an item is the one selected in the viewer, read outside a component. */
export function isArrangeSelection(
  plateId: string,
  ref: SetupItemRef
): boolean {
  const { selection } = arrangeAtom.get()
  return (
    selection !== null &&
    selection.plateId === plateId &&
    sameSetupItem(selection.item, ref)
  )
}

/** The selected item as the selected plate has it now. */
export type ArrangeTarget = { readonly plate: Plate; readonly item: SetupItem }

/** The selected item; null when nothing is selected, or its plate or the item is gone. */
export function useArrangeTarget(): ArrangeTarget | null {
  const selection = useArrangeSelection()
  const plate = useSelectedPlate()
  return useMemo(() => {
    if (!selection || !plate || plate.id !== selection.plateId) return null
    const item = setupItem(plate.setup, selection.item)
    return item && { plate, item }
  }, [selection, plate])
}
