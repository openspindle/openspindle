import { Store } from "@tanstack/react-store"
import { ok } from "@/domain/primitives"
import type { Result } from "@/domain/primitives"
import { applyCommand } from "@/domain/workspace/workspace"
import type {
  WorkspaceCommand,
  WorkspaceState,
} from "@/domain/workspace/workspace"
import { History, sameData } from "./history"
import type { StepId } from "./history"

export type DispatchOptions = {
  /**
   * False for a change that is not the user's edit, such as the libraries restored from
   * storage: it is no undo step, and undoing or redoing steps keeps it.
   */
  readonly record?: boolean
}

/**
 * Commands that are not the user's edits: the selection, what a device reports, saving and
 * dismissing notices. Undo and Redo keep what they did.
 */
const AMBIENT = new Set<WorkspaceCommand["type"]>([
  "plate.select",
  "plate.dismissNotice",
  "anchors.sync",
  "heightMap.store",
  "project.saved",
])

/**
 * How a command meets the history: an edit is an undo step, an ambient change outlasts undo and
 * redo, and replacing the workspace (opening or starting a project) starts a new history.
 */
function roleOf(command: WorkspaceCommand): "edit" | "ambient" | "replace" {
  if (command.type === "workspace.replace") return "replace"
  if (command.type !== "batch")
    return AMBIENT.has(command.type) ? "ambient" : "edit"
  const roles = command.commands.map(roleOf)
  if (roles.includes("replace")) return "replace"
  return roles.includes("edit") ? "edit" : "ambient"
}

/**
 * What an edit sets, so that quick edits of one value (typing a name, an operation editor saving as
 * it is edited) merge into one step; null for edits that are steps of their own.
 */
function mergeKey(command: WorkspaceCommand): string | null {
  switch (command.type) {
    case "plate.rename":
    case "groups.set":
      return `${command.type}:${command.plateId}`
    case "plate.setup":
      return `${command.type}:${command.plateId}:${Object.keys(command.patch).sort().join(",")}`
    case "fixture.update":
      return `${command.type}:${command.plateId}:${command.fixtureId}:${Object.keys(command.patch).sort().join(",")}`
    case "fixture.lock":
      return `${command.type}:${command.plateId}:${command.fixtureId}`
    case "fixture.setBed":
      return `${command.type}:${command.plateId}`
    case "operation.rename":
    case "operation.source":
    case "operation.tools":
      return `${command.type}:${command.plateId}:${command.operationId}`
    case "library.tools":
    case "library.stocks":
    case "ruleSettings.set":
      return command.type
    case "batch": {
      const keys = new Set<string>()
      for (const item of command.commands) {
        if (roleOf(item) !== "edit") continue
        const key = mergeKey(item)
        if (key === null) return null
        keys.add(key)
      }
      return keys.size ? [...keys].sort().join("|") : null
    }
    default:
      return null
  }
}

/** Whether two workspaces hold the same work, whichever plate is selected. */
const sameWork = (left: WorkspaceState, right: WorkspaceState) =>
  sameData(
    { ...left, selectedPlateId: null },
    { ...right, selectedPlateId: null }
  )

/**
 * A restored workspace keeps the plate selected now when it has it, else the plate it had
 * selected, else its first.
 */
function withSelection(
  restored: WorkspaceState,
  current: WorkspaceState
): WorkspaceState {
  const has = (plateId: string | null) =>
    restored.plates.some((plate) => plate.id === plateId)
  let selectedPlateId = restored.plates.at(0)?.id ?? null
  if (has(current.selectedPlateId)) selectedPlateId = current.selectedPlateId
  else if (has(restored.selectedPlateId))
    selectedPlateId = restored.selectedPlateId
  return selectedPlateId === restored.selectedPlateId
    ? restored
    : { ...restored, selectedPlateId }
}

/**
 * The workspace as a TanStack Store. Commands are the only way in: each one runs through the
 * pure domain handler, so a refused command leaves the state untouched and says why. The
 * history records the user's edits for Undo and Redo.
 */
export class WorkspaceStore {
  /**
   * The underlying TanStack store. Public only because `useWorkspace`'s selector needs a real
   * `Store` instance to subscribe to a slice of state; every other reader should use `state`,
   * `subscribe` or dispatch a command instead of reaching in here, which would bypass
   * `applyCommand` and the history.
   */
  readonly store: Store<WorkspaceState>
  /** The user's edits, which Undo and Redo step through. */
  readonly history = new History<WorkspaceState>({ same: sameWork })
  private projectSession = 0

  /** Changes when a project is replaced, even if its saved operation revisions match. */
  get session(): number {
    return this.projectSession
  }

  constructor(initial: WorkspaceState) {
    this.store = new Store(initial)
  }

  get state(): WorkspaceState {
    return this.store.state
  }

  readonly dispatch = (
    command: WorkspaceCommand,
    options?: DispatchOptions
  ): Result<WorkspaceState> => {
    const before = this.store.state
    const result = applyCommand(before, command)
    if (!result.ok || result.value === before) return result
    const next = this.kept(before, result.value, command, options)
    if (next !== before) {
      if (roleOf(command) === "replace") this.projectSession += 1
      this.store.setState(() => next)
    }
    return ok(next)
  }

  /** Undoes the latest edit, or only `step` while it is the latest; false when none was. */
  readonly undo = (step?: StepId): boolean =>
    this.restore(this.history.undo(step))

  /** Redoes the edit undone last; false when there is none. */
  readonly redo = (): boolean => this.restore(this.history.redo())

  readonly subscribe = (listener: (state: WorkspaceState) => void) => {
    const subscription = this.store.subscribe(listener)
    return () => subscription.unsubscribe()
  }

  /**
   * Records what a command changed in the history. Returns the state to keep: an edit of
   * nothing an undo restores keeps the parts as they were, so it leaves no unsaved changes.
   */
  private kept(
    before: WorkspaceState,
    after: WorkspaceState,
    command: WorkspaceCommand,
    options: DispatchOptions | undefined
  ): WorkspaceState {
    const role = roleOf(command)
    if (role === "replace") {
      this.history.clear()
      return after
    }
    if (role === "ambient" || options?.record === false) {
      this.history.note(before, after, (state) => {
        const replayed = applyCommand(state, command)
        return replayed.ok ? replayed.value : state
      })
      return after
    }
    if (this.history.record(before, after, mergeKey(command))) return after
    return after.selectedPlateId === before.selectedPlateId
      ? before
      : { ...before, selectedPlateId: after.selectedPlateId }
  }

  private restore(state: WorkspaceState | null): boolean {
    if (!state) return false
    const next = withSelection(state, this.store.state)
    if (next !== this.store.state) this.store.setState(() => next)
    return true
  }
}
