import { useLayoutEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  selectedPlate,
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { targetPlate } from "@/app/workspace/defaults"
import { createOperation } from "@/domain/operations/operation"
import type { Operation } from "@/domain/operations/operation"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import { plateLabel } from "@/domain/plate/plate"
import {
  WORKSPACE_MUTATION,
  useImportContext,
  workspaceScope,
} from "@/features/shell/use-import"
import { closeDialog } from "@/features/shell/dialogs"
import { usePrepareSelection } from "@/features/prepare/plate-tree/use-prepare-selection"
import { pcbJobActive, pcbLocked, usePcbLocked } from "./use-pcb-locked"
import { LIMITS } from "@/domain/pcb/manifest.mjs"
import { ACCEPT, hasAcceptedExtension, matchInputs } from "@/domain/pcb/inputs"
import {
  OPERATION_DATA_BYTES,
  dataBytes,
  newData,
  operationName,
} from "@/domain/pcb/operation-data"

/** Import at most 50 PCB files in one selection. */
const MAX_FILES = 50

/**
 * Import creates one pending operation per recognized file on the plate; each operation
 * keeps its own file and settings and is configured in the editor.
 */
export function ImporterView({
  plateId,
  disabled = false,
  onClose = closeDialog,
}: {
  plateId?: string
  disabled?: boolean
  onClose?: () => void
}) {
  const workspace = useWorkspaceStore()
  const queryClient = useQueryClient()
  const locked = usePcbLocked()
  const plates = useWorkspace((state) => state.plates)
  const selected = useWorkspace(selectedPlate)
  const context = useImportContext()
  const selection = usePrepareSelection()
  const plate = plates.find((item) => item.id === plateId) ?? selected
  const input = useRef<HTMLInputElement>(null)
  const readLock = useRef(false)
  const active = useRef(true)
  const isActive = () => active.current
  useLayoutEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inactive = disabled || locked || reading

  const imported = useMutation({
    mutationKey: WORKSPACE_MUTATION,
    scope: workspaceScope,
    mutationFn: async ({
      files,
      session,
    }: {
      files: File[]
      session: number
    }) => {
      if (!isActive()) return
      readLock.current = true
      setReading(true)
      setError(null)
      try {
        if (pcbJobActive(queryClient))
          throw new Error("PCB editing is unavailable while running a job.")
        if (workspace.session !== session)
          throw new Error(
            "The project changed before this import started. Import the files again."
          )
        const target = targetPlate(plate, context(), true)
        const operations: Operation[] = []
        for (const file of files) {
          // Only Gerber and drill files; anything else dropped with them is ignored.
          if (!hasAcceptedExtension(file.name)) continue
          if (file.size > LIMITS.inputFile)
            throw new Error(`${file.name} exceeds the 8 MiB source limit.`)
          const content = await file.text()
          if (!isActive()) return
          const matches = matchInputs({ name: file.name, content })
          // Known non-machining Gerber layers should not create empty operations.
          if (!matches.length && /TF\.FileFunction,/i.test(content)) continue
          // Any text file can end in .txt: only Excellon's M48 header makes it a drill file.
          if (!matches.length && /\.txt$/i.test(file.name)) continue
          // Ambiguous and undetected files keep an empty role for the editor to set.
          const role = matches.length === 1 ? matches[0] : ""
          const data = newData({ name: file.name, content }, role)
          if (dataBytes(data) > OPERATION_DATA_BYTES)
            throw new Error(
              `${file.name} is too large to keep in an operation.`
            )
          operations.push(
            createOperation(operationName(data), {
              kind: "pcb",
              data,
              nc: null,
            })
          )
        }
        if (!operations.length)
          throw new Error(
            "No supported PCB files found. Choose copper, solder mask, outline or drill files."
          )
        if (operations.length > MAX_FILES)
          throw new Error(`Import at most ${MAX_FILES} PCB files at once.`)
        if (workspace.session !== session)
          throw new Error(
            "The project changed while these files were being read. Import them again."
          )
        if (pcbJobActive(queryClient))
          throw new Error("PCB editing is unavailable while running a job.")
        if (!isActive()) return
        const commands: WorkspaceCommand[] = operations.map((operation) => ({
          type: "operation.add",
          plateId: target.id,
          operation,
        }))
        if (target !== plate)
          commands.unshift({
            type: "plates.add",
            plates: [target],
            select: true,
          })
        const result = workspace.dispatch({ type: "batch", commands })
        if (!result.ok) throw new Error(result.error)
        selection.selectOperation(target.id, operations[0].id)
        onClose()
      } catch (problem) {
        if (!isActive()) return
        setError(
          problem instanceof Error
            ? problem.message
            : "Could not import the selected files."
        )
      } finally {
        readLock.current = false
        if (isActive()) setReading(false)
      }
    },
  })

  function selectFiles(files: File[]) {
    if (
      !isActive() ||
      inactive ||
      pcbLocked(queryClient) ||
      readLock.current ||
      !files.length
    )
      return
    readLock.current = true
    imported.mutate({ files, session: workspace.session })
  }

  let target = "Add PCB operations to a new plate."
  if (plate)
    target = `Add operations to ${plateLabel(plate, plates.indexOf(plate))} · ${plate.setup.stock?.name ?? "No stock assigned"}`

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <FieldDescription>{target}</FieldDescription>
      <div
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-6"
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void selectFiles(Array.from(event.dataTransfer.files))
        }}
      >
        <FileUp />
        <span>Drop Gerber and drill files here</span>
        <FieldDescription>
          Each file creates its own operation on this plate. File types are
          detected automatically; unrelated files are ignored. Select an
          operation to choose its tool and settings.
        </FieldDescription>
        <Input
          ref={input}
          hidden
          type="file"
          multiple
          accept={ACCEPT}
          aria-label="Choose PCB source files"
          disabled={inactive}
          onChange={(event) => {
            void selectFiles(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={inactive}
          onClick={() => input.current?.click()}
        >
          {reading ? "Importing files…" : "Choose files"}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
