import { useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { ToolCard } from "@/components/workspace/tool-card"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import type { Tool } from "@/domain/tools/tool"
import { ToolLibraryDialog } from "@/features/tool-library"
import { OptionSelect } from "@/components/option-select"
import { useWorkspaceLibrary } from "@/features/tool-library/workspace-tool-library"
import { preferredPreset } from "@/domain/pcb/operation-settings"

/** No preset chosen yet; library presets always have an ID. */
const NO_PRESET = ""

/** After a tool, whether to apply one of its cutting presets; closing cancels the choice. */
function PresetStep({
  tool,
  suggested,
  onChoose,
  onCancel,
}: {
  tool: Tool
  suggested: string
  onChoose: (presetId: string | null) => void
  onCancel: () => void
}) {
  const id = useId()
  const [presetId, setPresetId] = useState(suggested)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply a cutting preset?</DialogTitle>
          <DialogDescription>
            The PCB operation can take the preset's spindle speed, feeds and
            depths, or keep the operation's current cutting values.
          </DialogDescription>
        </DialogHeader>
        <ToolCard tool={tool} />
        <Field>
          <FieldLabel htmlFor={id}>Cutting preset</FieldLabel>
          <OptionSelect
            id={id}
            className="w-full"
            options={[
              { value: NO_PRESET, label: "Choose a preset…" },
              ...tool.presets.map((preset) => ({
                value: preset.id,
                label: preset.name,
              })),
            ]}
            value={presetId}
            onValueChange={setPresetId}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onChoose(null)}>
            Keep current values
          </Button>
          <Button
            disabled={presetId === NO_PRESET}
            onClick={() => onChoose(presetId)}
          >
            Apply preset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The tool library followed by its cutting-preset choice. */
export function ToolChoiceDialog({
  selectedToolId,
  recommendedKinds,
  stockMaterial,
  onChoose,
  onCancel,
}: {
  selectedToolId: string
  recommendedKinds: readonly string[]
  stockMaterial?: string | null
  onChoose: (tool: Tool, presetId: string | null) => void
  onCancel: () => void
}) {
  const workspace = useWorkspaceStore()
  const library = useWorkspaceLibrary()
  const picked = useRef<string | null>(null)
  const [tool, setTool] = useState<Tool | null>(null)
  if (tool)
    return (
      <PresetStep
        tool={tool}
        suggested={preferredPreset(tool, stockMaterial)?.id ?? NO_PRESET}
        onChoose={(presetId) => onChoose(tool, presetId)}
        onCancel={onCancel}
      />
    )
  return (
    <ToolLibraryDialog
      title="Choose a tool"
      tools={library.tools}
      selectedId={selectedToolId}
      selectionOnly
      recommendedKinds={recommendedKinds}
      onChange={library.onChange}
      onSelect={(toolId) => {
        picked.current = toolId
      }}
      onClose={() => {
        const chosen = workspace.state.tools.find(
          (item) => item.id === picked.current
        )
        if (!chosen) onCancel()
        else if (chosen.presets.length) setTool(chosen)
        else onChoose(chosen, null)
      }}
    />
  )
}
