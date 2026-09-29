import { useRef, useState } from "react"
import type { DragEvent, ReactNode } from "react"
import { Upload } from "lucide-react"
import { toast } from "sonner"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useOpenProject } from "@/features/project/use-project"
import { isProjectFileName } from "@/features/project/project-file"
import { useOpenDialog } from "./dialogs"
import { useImportPlates } from "./use-import"

const carriesFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files")

/** Files dropped anywhere in the workspace: NC programs become plates; a project opens. */
export function FileDropZone({ children }: { children: ReactNode }) {
  const dialog = useOpenDialog()
  const importPlates = useImportPlates()
  const openProject = useOpenProject()
  const depth = useRef(0)
  const [dragging, setDragging] = useState(false)
  const accepts = (event: DragEvent) => dialog === null && carriesFiles(event)
  const drop = (files: File[]) => {
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
    // Every dropped file goes on, program or not: readPlates reports one that cannot be used
    // instead of it being silently left out.
    importPlates.mutate(files)
  }
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
        drop(Array.from(event.dataTransfer.files))
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
