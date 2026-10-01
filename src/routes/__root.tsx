import {
  HeadContent,
  Outlet,
  createRootRouteWithContext,
} from "@tanstack/react-router"
import type { QueryClient } from "@tanstack/react-query"
import { AppearanceProvider } from "@/components/appearance-provider"
import { Toaster } from "@/components/ui/sonner"
import { WorkLightControlProvider } from "@/components/work-light-control"
import { WorkLightPreferencesProvider } from "@/components/work-light-preferences"
import { ErrorReportHost } from "@/features/error-report/error-report-host"
import { useUnsavedChanges } from "@/features/project/use-unsaved-changes"
import { DialogHost } from "@/features/shell/dialog-host"
import { useCloseOrphanedDialog } from "@/features/shell/use-orphaned-dialog"
import { useWorkspaceMenu } from "@/features/shell/use-workspace-menu"
import { LoadIssuesDialog } from "@/features/workspace-load/load-issues-dialog"
import { useSaveErrors } from "@/features/workspace-load/use-save-errors"
import type { Host } from "@/platform/host"
import { useMachineSync } from "@/platform/machine"

export type RouterContext = {
  readonly host: Host
  readonly queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({ meta: [{ title: "OpenSpindle" }] }),
  component: RootLayout,
})

function RootLayout() {
  useMachineSync()
  useUnsavedChanges()
  // Menu commands and their dialogs work on every page.
  useWorkspaceMenu()
  useCloseOrphanedDialog()
  useSaveErrors()
  return (
    <>
      <HeadContent />
      <AppearanceProvider>
        <WorkLightPreferencesProvider>
          <WorkLightControlProvider>
            <Outlet />
            <DialogHost />
            <LoadIssuesDialog />
            <ErrorReportHost />
            <Toaster />
          </WorkLightControlProvider>
        </WorkLightPreferencesProvider>
      </AppearanceProvider>
    </>
  )
}
