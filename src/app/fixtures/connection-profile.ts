import type { WorkspaceStore } from "../workspace/store"

/** The connection whose profile this workspace already adopted, kept across page reloads. */
const adoptedConnections = new WeakMap<WorkspaceStore, string>()

export const adoptedProfileConnection = (
  workspace: WorkspaceStore
): string | null => adoptedConnections.get(workspace) ?? null

export function rememberProfileConnection(
  workspace: WorkspaceStore,
  connectionId: string | null
) {
  if (connectionId === null) adoptedConnections.delete(workspace)
  else adoptedConnections.set(workspace, connectionId)
}
