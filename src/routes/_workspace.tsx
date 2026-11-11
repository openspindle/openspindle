import { Outlet, createFileRoute } from "@tanstack/react-router"
import { useDeviceProfileSync } from "@/app/fixtures/use-device-profile-sync"
import { useStoredAnchorsSync } from "@/app/fixtures/use-stored-anchors-sync"
import { useMachineOriginSync } from "@/app/workspace/use-machine-origin-sync"
import { SectionErrorPlacement } from "@/features/error-report/error-fallback"
import { JobIndicator } from "@/features/job/job-indicator"
import { FileDropZone } from "@/features/shell/file-drop-zone"
import { WorkspaceTabs } from "@/features/shell/workspace-tabs"
import { ProjectWindowTitle } from "@/features/project/project-window-title"
import { useToolPictures } from "@/features/tool-library"
import { GuideHost } from "@/features/shell/dialog-host"
import { isGuideDialog, useOpenDialog } from "@/features/shell/dialogs"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"

export const Route = createFileRoute("/_workspace")({
  component: WorkspaceLayout,
})

function WorkspaceLayout() {
  useDeviceProfileSync()
  useStoredAnchorsSync()
  useMachineOriginSync()
  useToolPictures()
  const guideOpen = isGuideDialog(useOpenDialog())
  return (
    <FileDropZone>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
        {/* Doubles as the desktop title bar: it drags the window and clears the traffic lights. */}
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 border-b ps-[env(titlebar-area-x,--spacing(3))] pe-3 [app-region:drag] *:[app-region:no-drag]">
          <WorkspaceTabs />
          <ProjectWindowTitle />
          <div className="flex min-w-0 justify-end">
            <JobIndicator />
          </div>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel id="workspace" minSize={320}>
              <div className="flex h-full min-h-0 min-w-0">
                <SectionErrorPlacement>
                  <Outlet />
                </SectionErrorPlacement>
              </div>
            </ResizablePanel>
            {guideOpen && (
              <>
                <ResizableHandle withHandle aria-label="Resize guide sidebar" />
                <ResizablePanel
                  id="guide"
                  defaultSize={480}
                  minSize={360}
                  maxSize={760}
                  groupResizeBehavior="preserve-pixel-size"
                >
                  <GuideHost />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </div>
    </FileDropZone>
  )
}
