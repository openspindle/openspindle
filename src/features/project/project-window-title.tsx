import { useEffect, useState } from "react"
import { useWorkspace } from "@/app/workspace/workspace-context"
import {
  hasUnsavedChanges,
  watchProjectSaved,
} from "@/app/workspace/project-session"

export function ProjectWindowTitle() {
  const workspace = useWorkspace((value) => value)
  const [, refresh] = useState(0)
  useEffect(() => watchProjectSaved(() => refresh((value) => value + 1)), [])
  const named = !!workspace.project.fileDestination
  const label = named ? workspace.project.fileName : "Untitled"
  const title = `${!named || hasUnsavedChanges(workspace) ? "*" : ""}${label}`
  return (
    <span title={title} className="min-w-0 truncate text-center">
      {title}
    </span>
  )
}
