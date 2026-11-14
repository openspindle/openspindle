import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  FieldDescription,
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { FilePicker } from "@/components/file-picker"
import { OptionSelect } from "@/components/option-select"
import { AppDialog } from "@/features/shell/app-dialog"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { useHost } from "@/platform/host-context"
import {
  SharedLibrarySchema,
  sharedEntry,
  fromShared,
  sharedGeometryMatches,
} from "@/formats/shared-tools/library"
import type { SharedTool } from "@/formats/shared-tools/library"

type Choice = "keep" | "copy" | "replace"
export function SharedToolsDialog({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspaceStore(),
    host = useHost()
  const tools = useWorkspace((s) => s.tools)
  const [pending, setPending] = useState<SharedTool[]>([])
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [notes, setNotes] = useState<string[]>([])
  const exporting = useMutation({
    mutationFn: async () => {
      const before = workspace.state.tools
      const entries: SharedTool[] = [],
        warnings: string[] = []
      let next = [...before]
      for (const tool of before) {
        try {
          const entry = await sharedEntry(tool)
          if (entries.some((existing) => existing.id === entry.id))
            throw new Error(
              `${tool.name}: duplicate shared identity; export contains the first definition only.`
            )
          entries.push(entry)
          next = next.map((t) =>
            t.id === tool.id
              ? { ...t, shared: { id: entry.id, revision: entry.revision } }
              : t
          )
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : tool.name)
        }
      }
      setNotes(warnings)
      if (!entries.length)
        throw new Error("No supported dimensioned cutters to export.")
      const result = await host.files.save({
        kind: "sharedTools",
        suggestedName: "OpenSpindle.osptools",
        contents: JSON.stringify(
          { schema: "openspindle-shared-tools/1", units: "mm", tools: entries },
          null,
          2
        ),
      })
      if (result.status === "saved") {
        if (workspace.state.tools !== before)
          throw new Error(
            "Library changed during export; repeat export to retain shared IDs."
          )
        const changed = workspace.dispatch({
          type: "library.tools",
          tools: next,
        })
        if (!changed.ok) throw new Error(changed.error)
      }
    },
    onError: (error) => toast.error(error.message),
  })
  const importing = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 16 * 1024 * 1024)
        throw new Error("Shared library exceeds 16 MB.")
      const library = SharedLibrarySchema.parse(JSON.parse(await file.text()))
      setPending(library.tools)
      setChoices({})
      setNotes([])
    },
    onError: (error) => toast.error(error.message),
  })
  function apply() {
    let next = [...workspace.state.tools]
    for (const entry of pending) {
      const existing = next.find((t) => t.shared?.id === entry.id)
      if (existing && sharedGeometryMatches(existing, entry)) continue
      const choice = choices[entry.id] ?? "keep"
      if (existing && choice === "keep") continue
      let tool = fromShared(entry, next)
      if (existing && choice === "replace")
        tool = {
          ...existing,
          name: tool.name,
          kind: tool.kind,
          diameter: tool.diameter,
          flutes: tool.flutes,
          vendor: tool.vendor,
          productId: tool.productId,
          geometry: tool.geometry,
          shared: tool.shared,
          // An authored display mesh may no longer match the replaced geometry.
          model: null,
        }
      if (existing && choice === "copy")
        tool = { ...tool, shared: { ...tool.shared!, id: crypto.randomUUID() } }
      next = next.filter((t) => t.id !== tool.id).concat(tool)
    }
    const result = workspace.dispatch({ type: "library.tools", tools: next })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setPending([])
    toast.success("Shared library imported.")
  }
  return (
    <AppDialog title="Shared FreeCAD tool library" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <FilePicker
            accept=".osptools"
            aria-label="Shared tool library"
            onSelect={(files) => {
              if (files[0]) importing.mutate(files[0])
            }}
          >
            {(open) => (
              <Button onClick={open} disabled={importing.isPending}>
                Import
              </Button>
            )}
          </FilePicker>
          <Button
            variant="outline"
            onClick={() => exporting.mutate()}
            disabled={exporting.isPending}
          >
            Export for FreeCAD
          </Button>
        </div>
        <FieldDescription>
          Shared identity is independent of T number. Replacing a tool changes
          current jobs that use it; copy keeps their geometry.
        </FieldDescription>
        <FieldGroup>
          {pending.map((entry) => {
            const existing = tools.find((t) => t.shared?.id === entry.id)
            if (!existing)
              return (
                <FieldDescription key={entry.id}>
                  {entry.name} — new tool
                </FieldDescription>
              )
            if (sharedGeometryMatches(existing, entry))
              return (
                <FieldDescription key={entry.id}>
                  {entry.name} — unchanged revision
                </FieldDescription>
              )
            return (
              <Field key={entry.id}>
                <FieldLabel htmlFor={`shared-${entry.id}`}>
                  {entry.name} — changed revision
                </FieldLabel>
                <OptionSelect
                  id={`shared-${entry.id}`}
                  value={choices[entry.id] ?? "keep"}
                  options={[
                    { value: "keep", label: "Keep local" },
                    { value: "copy", label: "Import separate copy" },
                    { value: "replace", label: "Replace local geometry" },
                  ]}
                  onValueChange={(v) => {
                    setChoices({ ...choices, [entry.id]: v })
                  }}
                />
              </Field>
            )
          })}
        </FieldGroup>
        {pending.length > 0 && <Button onClick={apply}>Apply import</Button>}
        {notes.map((note, i) => (
          <FieldDescription key={i}>{note}</FieldDescription>
        ))}
      </div>
    </AppDialog>
  )
}
