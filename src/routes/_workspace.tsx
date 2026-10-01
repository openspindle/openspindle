import { Outlet, createFileRoute } from "@tanstack/react-router"
import { useDeviceProfileSync } from "@/app/fixtures/use-device-profile-sync"
import { useStoredAnchorsSync } from "@/app/fixtures/use-stored-anchors-sync"
import { SectionErrorPlacement } from "@/features/error-report/error-fallback"
import { JobIndicator } from "@/features/job/job-indicator"
import { FileDropZone } from "@/features/shell/file-drop-zone"
import { WorkspaceTabs } from "@/features/shell/workspace-tabs"
import { useToolPictures } from "@/features/tool-library"

export const Route = createFileRoute("/_workspace")({
  component: WorkspaceLayout,
})

function WorkspaceLayout() {
  useDeviceProfileSync()
  useStoredAnchorsSync()
  useToolPictures()
  return (
    <FileDropZone>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
        {/* Doubles as the desktop title bar: it drags the window and clears the traffic lights. */}
        <header className="flex shrink-0 items-center justify-between gap-4 border-b ps-[env(titlebar-area-x,--spacing(3))] pe-3 [app-region:drag] *:[app-region:no-drag]">
          <WorkspaceTabs />
          <JobIndicator />
        </header>
        <div className="flex min-h-0 flex-1">
          <SectionErrorPlacement>
            <Outlet />
          </SectionErrorPlacement>
        </div>
      </div>
    </FileDropZone>
  )
}
