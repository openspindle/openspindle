import { useDefaultLayout } from "react-resizable-panels"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { PrepareInspector } from "./inspector/prepare-inspector"
import { PlateTree } from "./plate-tree/plate-tree"
import { PrepareViewer } from "./prepare-viewer"
import { BedSetupField, DeviceCard } from "./sidebar-header"

/** Plates and their operations: set up stock, tools and fixtures, and preview them on the bed. */
export function PreparePage() {
  const layout = useDefaultLayout({
    id: "openspindle-prepare",
    panelIds: ["sidebar", "viewer"],
    onlySaveAfterUserInteractions: true,
  })
  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <ResizablePanel
        id="sidebar"
        defaultSize={420}
        minSize={320}
        maxSize={640}
        groupResizeBehavior="preserve-pixel-size"
      >
        <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-col gap-3 p-3">
            <DeviceCard />
            <BedSetupField />
          </div>
          <PlateTree className="max-h-[45%] shrink-0" />
          <PrepareInspector />
        </aside>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize side panel" />
      <ResizablePanel id="viewer" minSize={320}>
        <PrepareViewer />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
