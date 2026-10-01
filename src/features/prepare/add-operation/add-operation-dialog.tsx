import { useState } from "react"
import type { ReactNode } from "react"
import { ArrowLeft, CircuitBoard } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldSet } from "@/components/ui/field"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { ImporterView } from "@/features/pcb/importer"
import { AppDialog } from "@/features/shell/app-dialog"
import { useBuiltInSources } from "./built-in-sources"

function SourceItem({
  icon,
  title,
  description,
  onSelect,
}: {
  icon: ReactNode
  title: string
  description: string
  onSelect: () => void
}) {
  return (
    <Item
      render={
        <Button
          variant="ghost"
          className="h-auto whitespace-normal"
          type="button"
        />
      }
      className="text-left"
      onClick={onSelect}
    >
      <ItemMedia variant="icon">{icon}</ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription>{description}</ItemDescription>
      </ItemContent>
    </Item>
  )
}

/** Built-in machining and probing sources for adding an operation. */
export function AddOperationDialog({
  preset,
  onClose,
}: {
  preset?: "pcb"
  onClose: () => void
}) {
  const builtIns = useBuiltInSources()
  const [chosen, choose] = useState<"pcb" | null>(preset ?? null)
  if (chosen === "pcb")
    return (
      <AppDialog title="PCB" width="wide" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => choose(null)}
          >
            <ArrowLeft />
            All sources
          </Button>
          <ImporterView onClose={onClose} />
        </div>
      </AppDialog>
    )
  return (
    <AppDialog title="Add operation" width="wide" onClose={onClose}>
      <FieldSet>
        <SourceItem
          icon={<CircuitBoard />}
          title="PCB"
          description="Create operations from KiCad Gerber and Excellon files."
          onSelect={() => choose("pcb")}
        />
        {builtIns.map(({ id, icon: Icon, title, description, add }) => (
          <SourceItem
            key={id}
            icon={<Icon />}
            title={title}
            description={description}
            onSelect={() => {
              if (add()) onClose()
            }}
          />
        ))}
      </FieldSet>
    </AppDialog>
  )
}
