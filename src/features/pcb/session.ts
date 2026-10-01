import type { WorkspaceStore } from "@/app/workspace/store"
import type { SourceOf } from "@/domain/operations/operation"
import type { PCBOperationData } from "@/domain/pcb/operation-data"

/** An editor's unsaved recipe and the workspace state from which it was read. */
export type Draft = {
  readonly operationId: string
  readonly revision: number
  readonly source: SourceOf<"pcb">
  readonly dataKey: string
  readonly assignmentsKey: string
  readonly data: PCBOperationData
  readonly edited: boolean
}

export type PcbSession = {
  readonly id: number
  readonly drafts: Map<string, Draft>
  readonly updates: Map<string, AbortController>
}

const sessions = new WeakMap<WorkspaceStore, { current: PcbSession }>()
const freshSession = (id: number): PcbSession => ({
  id,
  drafts: new Map(),
  updates: new Map(),
})

/** Selection changes keep pending work; opening or starting a project discards it. */
export function pcbSession(workspace: WorkspaceStore): PcbSession {
  let session = sessions.get(workspace)
  if (!session) {
    const record = { current: freshSession(workspace.session) }
    workspace.subscribe(() => {
      if (record.current.id === workspace.session) return
      for (const controller of record.current.updates.values())
        controller.abort()
      record.current.updates.clear()
      record.current.drafts.clear()
      record.current = freshSession(workspace.session)
    })
    sessions.set(workspace, record)
    session = record
  }
  return session.current
}
