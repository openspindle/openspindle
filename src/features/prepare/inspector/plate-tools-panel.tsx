import { useEffect, useState } from "react"
import { Pencil } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToolCard } from "@/components/workspace/tool-card"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import type { Plate, PlateTool } from "@/domain/plate/plate"
import { isProbeSlot } from "@/domain/tools/tool-table"
import { openDialog } from "@/features/shell/dialogs"

export const toolNumberLabel = (number: number | null) =>
  number === null ? "Program tool" : `T${number}`

const byNumber = (a: PlateTool, b: PlateTool) =>
  (a.number ?? -1) - (b.number ?? -1)

/** Operations that use a table entry, by name. */
function usersOf(plate: Plate, number: number | null) {
  return plate.operations
    .filter((operation) =>
      operation.tools.some((binding) => binding.plate === number)
    )
    .map((operation) => operation.name)
}

/** Moves an entry to another number; the NC of every operation using it follows. */
function RenumberField({ plate, entry }: { plate: Plate; entry: PlateTool }) {
  const workspace = useWorkspaceStore()
  const current = entry.number
  const [draft, setDraft] = useState(String(current ?? ""))
  useEffect(() => setDraft(String(current ?? "")), [current])
  if (current === null || isProbeSlot(current)) return null
  const commit = () => {
    const to = Number(draft)
    if (!draft.trim() || to === current) {
      setDraft(String(current))
      return
    }
    const result = workspace.dispatch({
      type: "tool.renumber",
      plateId: plate.id,
      from: current,
      to,
    })
    if (!result.ok) {
      toast.error(result.error)
      setDraft(String(current))
    }
  }
  return (
    <Field orientation="horizontal" className="w-auto">
      <FieldLabel htmlFor={`tool-number-${plate.id}-${current}`}>T</FieldLabel>
      <Input
        id={`tool-number-${plate.id}-${current}`}
        className="w-20 font-numeric"
        aria-label={`Number of T${current}`}
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur()
          if (event.key === "Escape") setDraft(String(current))
        }}
      />
    </Field>
  )
}

/** The plate's tool table: which library tool each T number holds, and who uses it. */
export function PlateToolsPanel({ plate }: { plate: Plate }) {
  const library = useWorkspace((state) => state.tools)
  const entries = [...plate.tools].sort(byNumber)
  return (
    <div className="flex flex-col gap-3 p-3" aria-label="Tool table">
      {entries.map((entry) => {
        const tool = library.find((item) => item.id === entry.toolId)
        const users = usersOf(plate, entry.number)
        return (
          <div key={entry.number ?? "program"} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <ToolCard
                className="min-w-0 flex-1"
                tool={tool}
                slotLabel={toolNumberLabel(entry.number)}
                emptyLabel={
                  entry.toolId ? "Missing from the library" : "Assign tool"
                }
                onClick={() =>
                  openDialog({
                    kind: "tools",
                    assign: { plateId: plate.id, number: entry.number },
                  })
                }
              />
              <RenumberField plate={plate} entry={entry} />
            </div>
            {users.length > 0 && (
              <FieldDescription>Used by {users.join(", ")}</FieldDescription>
            )}
          </div>
        )
      })}
      {!entries.length && (
        <FieldDescription>
          The plate's operations select no tools.
        </FieldDescription>
      )}
      <Button
        variant="ghost"
        className="justify-start"
        onClick={() => openDialog({ kind: "tools" })}
      >
        <Pencil />
        Manage tool library
      </Button>
    </div>
  )
}
