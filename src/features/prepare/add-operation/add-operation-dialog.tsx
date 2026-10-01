import { useState } from "react"
import { ArrowLeft, CircuitBoard, Crosshair } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FieldSet } from "@/components/ui/field"
import { ImporterView } from "@/features/pcb/importer"
import { AppDialog } from "@/features/shell/app-dialog"
import {
  PROBING_DESCRIPTION,
  ProbingSteps,
  useProbingReason,
} from "./probing-picker"
import { SourceItem } from "./source-item"

/** Built-in machining and probing sources for adding an operation. */
export function AddOperationDialog({
  preset,
  onClose,
}: {
  preset?: "pcb"
  onClose: () => void
}) {
  const probingReason = useProbingReason()
  const [chosen, choose] = useState<"pcb" | "probing" | null>(preset ?? null)
  if (chosen === "probing")
    return (
      <AppDialog title="Probing" width="wide" onClose={onClose}>
        <ProbingSteps onAdded={onClose} onBack={() => choose(null)} />
      </AppDialog>
    )
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
        <SourceItem
          icon={<Crosshair />}
          title="Probing"
          description={PROBING_DESCRIPTION}
          reason={probingReason}
          onSelect={() => choose("probing")}
        />
      </FieldSet>
    </AppDialog>
  )
}
