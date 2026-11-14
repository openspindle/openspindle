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
    // `reported` is the last state the host confirmed; `latest` is the last one asked for. A
    // send only counts, or retries, while it is still the latest: a superseded one is dropped,
    // since the newer send that replaced it already carries the state that now matters.
    let reported: string | null = null
    let latest: string | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const send = (edited: boolean, name: string, key: string) => {
      void host.window.setEdited(edited, name).then(
        () => {
          if (latest === key) reported = key
        },
        (error: unknown) => {
          log.error("Reporting unsaved changes to the window failed", error)
          if (latest === key)
            retryTimer = setTimeout(
              () => send(edited, name, key),
              RETRY_DELAY_MS
            )
        }
      )
    }
    const report = () => {
      const state = workspace.state
      const edited = hasUnsavedChanges(state)
      const name = state.project.fileDestination ? state.project.fileName : ""
      const key = `${String(edited)}:${name}`
      if (key === reported) return
      latest = key
      clearTimeout(retryTimer)
      send(edited, name.slice(0, 200), key)
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
