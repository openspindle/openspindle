import { DevicePicker } from "@/features/device/device-picker"
import { FusionSource } from "@/features/fusion360/fusion-source"
import { FusionPairingDialog } from "@/features/fusion360/fusion-pairing-dialog"
import { useFusionPairing } from "@/features/fusion360/use-fusion-pairing"
import { useFusionSync } from "@/platform/fusion"
import { HeightMapDialog } from "@/features/device/height-map-dialog"
import { GCodeGlossaryDialog } from "@/features/glossary/gcode-glossary-dialog"
import { ModelsDialog } from "@/features/models/models-dialog"
import { AddOperationDialog } from "@/features/prepare/add-operation/add-operation-dialog"
import { ProgramSourceDialog } from "@/features/prepare/source/program-source-dialog"
import {
  NewProjectDialog,
  OpenProjectDialog,
  ProjectReportDialog,
} from "@/features/project/project-dialogs"
import { StockDialog } from "@/features/prepare/stock/stock-dialog"
import { SettingsDialog } from "@/features/settings/settings-dialog"
import { WorkspaceToolLibrary } from "@/features/tool-library"
import { WorkspaceSettingsDialog } from "@/features/workspace-settings/workspace-settings-dialog"
import { AppDialog } from "./app-dialog"
import { closeDialog, openDialog, useOpenDialog } from "./dialogs"
import { ImportDialog } from "./import-dialog"
import type { WorkspaceDialog } from "./dialogs"

/** The open workspace dialog; opening another replaces it. */
function OpenDialog({ dialog }: { dialog: WorkspaceDialog }) {
  switch (dialog.kind) {
    case "fusion":
      return (
        <AppDialog title="Fusion 360" width="wide" onClose={closeDialog}>
          <FusionSource onDone={closeDialog} />
        </AppDialog>
      )
    case "fusion-pairing":
      return (
        <FusionPairingDialog
          key={dialog.requestId}
          requestId={dialog.requestId}
          returnToFusion={dialog.returnToFusion}
        />
      )
    case "device":
      return (
        <AppDialog title="Connect device" onClose={closeDialog}>
          <DevicePicker close={closeDialog} />
        </AppDialog>
      )
    case "models":
      return <ModelsDialog onClose={closeDialog} />
    case "height-map":
      return <HeightMapDialog onClose={closeDialog} />
    case "stock":
      return <StockDialog plateId={dialog.plateId} onClose={closeDialog} />
    case "tools":
      return (
        <WorkspaceToolLibrary assign={dialog.assign} onClose={closeDialog} />
      )
    case "source":
      return (
        <ProgramSourceDialog
          plateId={dialog.plateId}
          operationId={dialog.operationId}
          onClose={closeDialog}
        />
      )
    case "add-operation":
      return <AddOperationDialog preset={dialog.preset} onClose={closeDialog} />
    case "new-project":
      return <NewProjectDialog />
    case "open-project":
      return <OpenProjectDialog candidate={dialog.candidate} />
    case "project-report":
      return <ProjectReportDialog report={dialog.report} />
    case "settings":
      return <SettingsDialog section={dialog.section} onClose={closeDialog} />
    case "workspace-settings":
      return <WorkspaceSettingsDialog onClose={closeDialog} />
    case "import":
      return <ImportDialog plan={dialog.plan} />
    case "gcode-glossary": {
      const { back } = dialog
      return (
        <GCodeGlossaryDialog
          onClose={() => (back ? openDialog(back) : closeDialog())}
        />
      )
    }
  }
}

/** Renders the open workspace dialog. */
export function DialogHost() {
  useFusionSync()
  useFusionPairing()
  const dialog = useOpenDialog()
  return dialog && <OpenDialog dialog={dialog} />
}
