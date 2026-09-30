import { Folder } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldDescription } from "@/components/ui/field"
import {
  useCompiledPlate,
  useSelectedPlate,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { newId } from "@/domain/primitives"
import {
  clearSectionSelection,
  selectedSections,
  useSectionSelection,
} from "../selection"
import { groupableSections } from "./tree-rows"

/** Actions on the program sections selected in the tree: group them, or clear the selection. */
export function SelectionBar() {
  const workspace = useWorkspaceStore()
  const plate = useSelectedPlate()
  const compiled = useCompiledPlate(plate)
  const selection = useSectionSelection()
  if (!plate || !compiled) return null
  const selected = selectedSections(plate, compiled, selection)
  if (selected.length < 2) return null
  const groupable = groupableSections(plate, compiled, selected)
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2">
      <FieldDescription className="font-numeric">
        {selected.length} selected
      </FieldDescription>
      <Button
        variant="outline"
        size="xs"
        disabled={!groupable}
        title={
          groupable
            ? "Group the selected sections"
            : "Select adjacent, ungrouped sections of one operation"
        }
        onClick={() => {
          if (!groupable) return
          workspace.dispatch({
            type: "groups.set",
            plateId: plate.id,
            groups: [
              ...plate.groups,
              {
                id: newId(),
                name: `Group ${plate.groups.length + 1}`,
                sectionIds: groupable.map((section) => section.id),
              },
            ],
          })
          clearSectionSelection()
        }}
      >
        <Folder />
        Group
      </Button>
      <Button variant="ghost" size="xs" onClick={clearSectionSelection}>
        Clear
      </Button>
    </div>
  )
}
