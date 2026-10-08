import { useEffect } from "react"
import { log } from "@/app/errors/log"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { useHost } from "@/platform/host-context"
import {
  hasUnsavedChanges,
  watchProjectSaved,
} from "@/app/workspace/project-session"

/** How long to wait before trying again to tell the host of an edited state it did not get. */
const RETRY_DELAY_MS = 5000

/**
 * Mounted once: tells the host whether the project has unsaved changes. The workspace is not
 * kept between launches, so the host asks before closing with unsaved changes.
 */
export function useUnsavedChanges() {
  const host = useHost()
  const workspace = useWorkspaceStore()
  useEffect(() => {
    // `latest` is the last state asked for. The host gets them in order, so each change is sent,
    // even one back before the host confirmed the last (edited, then saved again at once). A
    // failed send retries while it is still the latest.
    let latest: string | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const send = (edited: boolean, name: string, key: string) => {
      void host.window.setEdited(edited, name).catch((error: unknown) => {
        log.error("Reporting unsaved changes to the window failed", error)
        if (latest === key)
          retryTimer = setTimeout(() => send(edited, name, key), RETRY_DELAY_MS)
      })
    }
    const report = () => {
      const state = workspace.state
      const edited = hasUnsavedChanges(state)
      const key = `${String(edited)}:${state.project.name}`
      if (key === latest) return
      latest = key
      clearTimeout(retryTimer)
      send(edited, state.project.name, key)
    }
    report()
    const stopWorkspace = workspace.subscribe(report)
    const stopSaved = watchProjectSaved(report)
    return () => {
      latest = null
      clearTimeout(retryTimer)
      stopWorkspace()
      stopSaved()
    }
  }, [host, workspace])
}
