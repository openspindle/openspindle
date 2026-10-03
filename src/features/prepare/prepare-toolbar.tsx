import { CircuitBoard, Crosshair, Settings2, ShieldCheck } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ToolbarButton } from "@/components/workspace/toolbar-button"
import {
  selectedPlate,
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { checkPlateDesignRules } from "@/features/design-rules/design-rule-check"
import { openDialog } from "@/features/shell/dialogs"
import {
  PROBING_DESCRIPTION,
  useProbingReason,
} from "./add-operation/probing-picker"
import { ArrangeTools } from "./arrange/arrange-tools"

/**
 * Tools over the viewer, as icons that say what they do on hover: moving and locking what is
 * selected in it, the Probing and PCB actions, then checking the selected plate's design rules
 * and the workspace settings.
 */
export function PrepareToolbar() {
  const probingReason = useProbingReason()
  const workspace = useWorkspaceStore()
  const hasPlate = useWorkspace((state) => selectedPlate(state) !== null)
  return (
    <Card
      size="sm"
      className="absolute top-4 left-1/2 z-10 max-w-[calc(100%-140px)] -translate-x-1/2 p-1"
    >
      <TooltipProvider>
        {/* Scrolls sideways only: a pressed button sinks, which would show a vertical scrollbar. */}
        <div
          className="flex items-center gap-1 overflow-x-auto overflow-y-hidden"
          role="toolbar"
          aria-label="Prepare tools"
        >
          <ArrangeTools />
          <Separator orientation="vertical" />
          <ToolbarButton
            label="Probing"
            description={PROBING_DESCRIPTION}
            reason={probingReason}
            onClick={() => openDialog({ kind: "probing" })}
          >
            <Crosshair />
          </ToolbarButton>
          <ToolbarButton
            label="PCB"
            description="Create operations from KiCad Gerber and Excellon files."
            onClick={() => openDialog({ kind: "add-operation", preset: "pcb" })}
          >
            <CircuitBoard />
          </ToolbarButton>
          <Separator orientation="vertical" />
          <ToolbarButton
            label="Check design rules"
            description="Checks the selected plate's program against the project's design rules, and lists what breaks them."
            reason={hasPlate ? null : "There is no plate to check."}
            onClick={() => checkPlateDesignRules(workspace.state)}
          >
            <ShieldCheck />
          </ToolbarButton>
          <ToolbarButton
            label="Workspace settings"
            description="The project's settings, such as its design rules."
            onClick={() => openDialog({ kind: "workspace-settings" })}
          >
            <Settings2 />
          </ToolbarButton>
        </div>
      </TooltipProvider>
    </Card>
  )
}
