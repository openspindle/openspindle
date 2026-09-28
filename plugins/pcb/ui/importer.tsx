import { useRef, useState } from "react"
import {
  useCloseView,
  useCreateOperations,
  useViewContext,
  useWorkspace,
} from "@openspindle/plugin-sdk"
import type { OperationDraft } from "@openspindle/plugin-sdk"
import {
  Button,
  FieldDescription,
  FileUp,
  Input,
} from "@openspindle/plugin-sdk/ui"
import { LIMITS } from "../src/manifest.mjs"
import { ACCEPT, hasAcceptedExtension, matchInputs } from "./inputs"
import {
  OPERATION_DATA_BYTES,
  dataBytes,
  dataJson,
  newData,
  operationName,
} from "./operation-data"

/** operations.create adds at most 50 operations at once. */
const MAX_FILES = 50

/**
 * Import creates one pending operation per recognized file on the plate; each operation
 * keeps its own file and settings and is configured in the editor.
 */
export function ImporterView() {
  const { plateId, disabled } = useViewContext()
  const workspace = useWorkspace()
  const create = useCreateOperations()
  const close = useCloseView()
  const targetId = plateId ?? workspace.data?.selectedPlateId ?? null
  const plate = workspace.data?.plates.find((item) => item.id === targetId)
  const input = useRef<HTMLInputElement>(null)
  const readLock = useRef(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inactive = disabled || reading || !plate

  async function selectFiles(files: File[]) {
    if (inactive || readLock.current || !files.length) return
    readLock.current = true
    setReading(true)
    setError(null)
    try {
      const operations: OperationDraft[] = []
      for (const file of files) {
        // Only Gerber and drill files; anything else dropped with them is ignored.
        if (!hasAcceptedExtension(file.name)) continue
        if (file.size > LIMITS.inputFile)
          throw new Error(`${file.name} exceeds the 8 MiB source limit.`)
        const content = await file.text()
        const matches = matchInputs({ name: file.name, content })
        // Known non-machining Gerber layers should not create empty operations.
        if (!matches.length && /TF\.FileFunction,/i.test(content)) continue
        // Any text file can end in .txt: only Excellon's M48 header makes it a drill file.
        if (!matches.length && /\.txt$/i.test(file.name)) continue
        // Ambiguous and undetected files keep an empty role for the editor to set.
        const role = matches.length === 1 ? matches[0] : ""
        const data = newData({ name: file.name, content }, role)
        const json = dataJson(data)
        if (dataBytes(json) > OPERATION_DATA_BYTES)
          throw new Error(`${file.name} is too large to keep in an operation.`)
        operations.push({ name: operationName(data), data: json, nc: null })
      }
      if (!operations.length)
        throw new Error(
          "No supported PCB files found. Choose front, back, outline or drill files."
        )
      if (operations.length > MAX_FILES)
        throw new Error(`Import at most ${MAX_FILES} PCB files at once.`)
      const created = await create.mutateAsync({
        plateId: plate.id,
        operations,
      })
      // Done: close, showing the first new operation for its tool and settings.
      await close({ select: created[0]?.id }).catch(() => undefined)
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : "Could not import the selected files."
      )
    } finally {
      readLock.current = false
      setReading(false)
    }
  }

  let target = "Select a plate before importing PCB files."
  if (workspace.isPending) target = "Loading the workspace…"
  else if (workspace.error) target = workspace.error.message
  else if (plate)
    target = `Add operations to ${plate.name} · ${plate.stock?.name ?? "No stock assigned"}`

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
