import { createAtom } from "@tanstack/react-store"
import { libraryOf } from "@/domain/workspace/library"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import type { Result } from "@/domain/primitives"
import type { ProfileAnchors } from "@/app/fixtures/fixture-library-store"
import { emptyPlate, newProject } from "./defaults"
import type { PlatePlacement } from "./import-program"
import type { WorkspaceStore } from "./store"

/**
 * What the project held when it was last saved or opened, or when the app started. The tool
 * and stock libraries are not part of it: the app keeps them on its own.
 */
type Baseline = Pick<
  WorkspaceState,
  "plates" | "heightMaps" | "ruleSettings"
> & {
  readonly name: string
}

/**
 * Set when the app starts with a new project, so there is always one to compare with; "edited"
 * when a reload restored the workspace with unsaved changes, and the baseline stayed behind.
 */
const baselineAtom = createAtom<Baseline | "edited" | null>(null)

const baselineOf = (state: WorkspaceState): Baseline => ({
  plates: state.plates,
  heightMaps: state.heightMaps,
  ruleSettings: state.ruleSettings,
  name: state.project.name,
})

/** The workspace now matches its project: saved, opened, or the new one the app starts with. */
export function markProjectSaved(state: WorkspaceState) {
  baselineAtom.set(() => baselineOf(state))
}

/**
 * Replaces the project with a new one on the same libraries, the one the app starts with: the
 * bed as its empty plate 1, set up with `placement` (the selected fixture profile's). The
 * project counts as saved only once the replacement itself goes through.
 */
export function startNewProject(
  workspace: WorkspaceStore,
  placement: PlatePlacement
): Result<WorkspaceState> {
  const result = workspace.dispatch({
    type: "batch",
    commands: [
      {
        type: "workspace.replace",
        state: newProject(libraryOf(workspace.state)),
      },
      { type: "plates.add", plates: [emptyPlate(placement)], select: true },
    ],
  })
  if (result.ok) markProjectSaved(workspace.state)
  return result
}

/**
 * Whether the workspace differs from its project as last saved or opened. Workspace state is
 * immutable, so an unchanged part keeps its identity.
 */
export function hasUnsavedChanges(state: WorkspaceState): boolean {
  const baseline = baselineAtom.get()
  if (!baseline) return false
  if (baseline === "edited") return true
  const current = baselineOf(state)
  return (
    current.plates !== baseline.plates ||
    current.heightMaps !== baseline.heightMaps ||
    current.ruleSettings !== baseline.ruleSettings ||
    current.name !== baseline.name
  )
}

/**
 * The workspace has unsaved changes, though not ones it can tell from the project: a reload
 * restored it that way. It has them until the project is saved, opened or started anew.
 */
export function markProjectEdited() {
  baselineAtom.set(() => "edited")
}

/**
 * Plates set up for a device (or for none yet) follow its anchors and those of their bed setups;
 * the connected device's, every plate moves to it. That is not an edit of the project: a
 * project without unsaved changes keeps none, since following them again is the same.
 */
export function followDeviceAnchors(
  workspace: WorkspaceStore,
  { deviceId, anchors, bedSetups }: ProfileAnchors,
  connected = false
) {
  const unchanged = !hasUnsavedChanges(workspace.state)
  workspace.dispatch({
    type: "anchors.sync",
    deviceId,
    anchors,
    bedSetups,
    connected,
  })
  if (unchanged) markProjectSaved(workspace.state)
}

/** Calls `listener` whenever the project is saved or opened; edits come from the workspace. */
export function watchProjectSaved(listener: () => void): () => void {
  const subscription = baselineAtom.subscribe(() => listener())
  return () => subscription.unsubscribe()
}
