import { X } from "lucide-react"
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import type { Plate } from "@/domain/plate/plate"
import type { PrepareSearch } from "@/routes/_workspace/prepare"
import { useKeyedDiagnostics } from "@/app/workspace/use-plate-diagnostics"
import { diagnosticOperation } from "@/domain/diagnostics"
import { DiagnosticsList } from "./diagnostics-list"
import { PlateFixturesPanel } from "./plate-fixtures-panel"
import { PlateSetupPanel } from "./plate-setup-panel"
import { PlateToolsPanel } from "./plate-tools-panel"

type Panel = NonNullable<PrepareSearch["panel"]>
const isPanel = (value: unknown): value is Panel =>
  value === "setup" || value === "tools" || value === "fixtures"

/** What an import changed on a plate, until the user dismisses it. */
function PlateNotices({ plate }: { plate: Plate }) {
  const workspace = useWorkspaceStore()
  if (!plate.notices.length) return null
  return (
    <div className="flex flex-col gap-2" aria-label="Plate notices">
      {plate.notices.map((notice) => (
        <Alert key={notice.id}>
          <AlertDescription>{notice.message}</AlertDescription>
          <AlertAction>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss notice"
              onClick={() =>
                workspace.dispatch({
                  type: "plate.dismissNotice",
                  plateId: plate.id,
                  noticeId: notice.id,
                })
              }
            >
              <X />
            </Button>
          </AlertAction>
        </Alert>
      ))}
    </div>
  )
}

/** The selected plate: its setup, tool table and fixtures, with what needs attention. */
export function PlateInspector({
  plate,
  panel,
  onPanel,
}: {
  plate: Plate
  panel: PrepareSearch["panel"]
  onPanel: (panel: Panel) => void
}) {
  const diagnostics = useKeyedDiagnostics(plate).filter(
    ({ diagnostic }) => diagnosticOperation(diagnostic) === null
  )
  const attention = plate.notices.length > 0 || diagnostics.length > 0
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t">
      {attention && (
        <div className="flex shrink-0 flex-col gap-2 p-3">
          <PlateNotices plate={plate} />
          <DiagnosticsList plate={plate} diagnostics={diagnostics} />
        </div>
      )}
      <Tabs
        value={panel ?? "setup"}
        onValueChange={(value) => {
          if (isPanel(value)) onPanel(value)
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList
          variant="line"
          className="w-full shrink-0 border-b px-2"
          aria-label="Plate settings"
        >
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="tools">
            Tools
            <Badge variant="secondary" className="font-numeric">
              {plate.tools.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="fixtures">Fixtures</TabsTrigger>
        </TabsList>
        <TabsContent value="setup" className="min-h-0 overflow-y-auto">
          <PlateSetupPanel plate={plate} />
        </TabsContent>
        <TabsContent value="tools" className="min-h-0 overflow-y-auto">
          <PlateToolsPanel plate={plate} />
        </TabsContent>
        <TabsContent value="fixtures" className="min-h-0 overflow-y-auto">
          <PlateFixturesPanel plate={plate} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
