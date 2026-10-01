import { useEffect } from "react"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { keyForViewer } from "@/components/workspace/viewer/setup-arranger"
import {
  selectSetupItem,
  setMoveAxes,
  setMoving,
  setPicking,
  useArrange,
} from "./arrange-state"
import type { ArrangeTarget } from "./arrange-state"
import { toggleLock } from "./use-arrange-events"

/**
 * Keys for the selected setup item: M moves, L locks, X, Y and Z keep a move to one axis (again
 * for X and Y), Escape ends picking, then move mode, and then clears the selection. The viewer's
 * own Escape (dropping a drag or a picked point) comes first. Nothing moves while picking.
 */
export function useArrangeShortcuts(target: ArrangeTarget | null) {
  const workspace = useWorkspaceStore()
  const state = useArrange()
  useEffect(() => {
    const movable = !!target && !target.item.fixed
    const moving = state.moving && movable
    const handle = (key: string) => {
      switch (key) {
        case "escape":
          if (state.picking) setPicking(null)
          else if (moving) setMoving(false)
          else if (state.selection) selectSetupItem(null)
          else return false
          return true
        case "m":
          if (!movable || state.picking) return false
          setMoving(!moving)
          return true
        case "l":
          if (!target || target.item.locked === null) return false
          toggleLock(workspace, target)
          return true
        case "x":
        case "y":
        case "z":
          if (!moving) return false
          setMoveAxes(state.axes === key ? "xy" : key)
          return true
        default:
          return false
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !keyForViewer(event)
      )
        return
      if (handle(event.key.toLowerCase())) event.preventDefault()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [target, state, workspace])
}
