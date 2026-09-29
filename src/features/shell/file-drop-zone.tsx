import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { DragEvent, ReactNode } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Upload } from "lucide-react"
import { toast } from "sonner"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { describeProblems } from "@/app/workspace/import-files"
import { useOpenProject } from "@/features/project/use-project"
import { isProjectFileName } from "@/features/project/project-file"
import type { OpenedFiles } from "@/platform/contract/files"
import { useHost } from "@/platform/host-context"
import { useOpenDialog } from "./dialogs"
import { useImportFiles } from "./use-import"

const carriesFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files")

/**
 * Files handed to the workspace, dropped on it or opened from Finder: NC programs join the
 * selected plate, a plate exported with its setup comes in as a plate of its own, and a
 * project opens.
 */
function useTakeFiles() {
  const importFiles = useImportFiles()
  const openProject = useOpenProject()
  return (files: File[]) => {
    const projects = files.filter((file) => isProjectFileName(file.name))
    if (projects.length) {
      if (projects.length === 1 && files.length === 1)
        openProject.mutate({ file: projects[0] })
      else
        toast.error(
          "Open one STEP-NC project at a time, separately from NC programs."
        )
      return
    }
    // Every file goes on, program or not: planning the import reports one that cannot be used
    // instead of it being silently left out.
    importFiles.mutate(files)
  }
}

/**
 * Takes the files macOS asks the app to open, with Finder's Open With, a double-click or the
 * Dock icon, as dropped ones, in Prepare.
 */
function useOpenedFiles(take: (files: File[]) => void) {
  const host = useHost()
  const navigate = useNavigate()
  const opened = useEffectEvent(({ files, problems }: OpenedFiles) => {
    if (problems.length) toast.error(describeProblems(problems))
    if (!files.length) return
    void navigate({ to: "/prepare" })
    take(files.map((file) => new File([file.contents], file.fileName)))
  })
  useEffect(() => host.files.subscribeOpened((files) => opened(files)), [host])
}

/**
 * Files dropped anywhere in the workspace, or opened from Finder: NC programs join the selected
 * plate, a plate exported with its setup comes in as a plate of its own, and a project opens.
 */
export function FileDropZone({ children }: { children: ReactNode }) {
  const dialog = useOpenDialog()
  const take = useTakeFiles()
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  useOpenedFiles(take)
  const accepts = (event: DragEvent) => dialog === null && carriesFiles(event)
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragEnter={(event) => {
        if (!accepts(event)) return
        event.preventDefault()
        depth.current++
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (accepts(event)) event.preventDefault()
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        if (!accepts(event)) return
        event.preventDefault()
        depth.current = 0
        setDragging(false)
        take(Array.from(event.dataTransfer.files))
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Upload />
              </EmptyMedia>
              <EmptyTitle>Drop NC files or a project</EmptyTitle>
              <EmptyDescription>
                .nc · .cnc · .gcode · .tap · .ngc · .stpnc
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )}
    </div>
  )
}
