import { SharedToolsDialog } from "@/features/tool-library/shared-tools-dialog"
import { ReferenceDialog } from "@/features/models/reference-dialog"
import { DevicePicker } from "@/features/device/device-picker"
import { AnchorCalibrationDialog } from "@/features/device/anchor-calibration-dialog"
import { ProbeDiameterCalibrationDialog } from "@/features/device/probe-diameter-calibration-dialog"
import { ZProbeDialog } from "@/features/device/z-probe-dialog"
import { PointActionsDialog } from "@/features/prepare/point-actions-dialog"
import { GuidedSetup } from "@/features/workshop/guided-setup"
import { FacingDialog } from "@/features/workshop/facing-dialog"
import { MeasurementSetup } from "@/features/workshop/measurement-setup"
import { ProcessDialog } from "@/features/workshop/process-dialog"
import { DeviceConfigurationDialog } from "@/features/device/device-configuration"
import { FusionSource } from "@/features/fusion360/fusion-source"
import { FusionPairingDialog } from "@/features/fusion360/fusion-pairing-dialog"
import { useFusionPairing } from "@/features/fusion360/use-fusion-pairing"
import { useFusionSync } from "@/platform/fusion"
import { FixtureDefinitionDialog } from "@/features/device/fixture-definition-dialog"
import { HeightMapDialog } from "@/features/device/height-map-dialog"
import { SetOriginDialog } from "@/features/device/set-origin-dialog"
import { GCodeGlossaryDialog } from "@/features/glossary/gcode-glossary-dialog"
import { ModelsDialog } from "@/features/models/models-dialog"
import { AddOperationDialog } from "@/features/prepare/add-operation/add-operation-dialog"
import { ProbingPicker } from "@/features/prepare/add-operation/probing-picker"
import { InspectionWizard } from "@/features/probing/inspection-wizard"
import { ProgramSourceDialog } from "@/features/prepare/source/program-source-dialog"
import {
  NewProjectDialog,
  OpenProjectDialog,
  ProjectReportDialog,
} from "@/features/project/project-dialogs"
import { StockDialog } from "@/features/prepare/stock/stock-dialog"
import { AddFixtureDialog } from "@/features/prepare/fixtures/add-fixture-dialog"
import { SettingsDialog } from "@/features/settings/settings-dialog"
import { WorkspaceToolLibrary } from "@/features/tool-library"
import { WorkspaceSettingsDialog } from "@/features/workspace-settings/workspace-settings-dialog"
import { AppDialog, GuidePanelContext } from "./app-dialog"
import {
  closeDialog,
  isGuideDialog,
  openDialog,
  useOpenDialog,
} from "./dialogs"
import { ImportDialog } from "./import-dialog"
import type { WorkspaceDialog } from "./dialogs"

/** The open workspace dialog; opening another replaces it. */
function OpenDialog({ dialog }: { dialog: WorkspaceDialog }) {
  switch (dialog.kind) {
    case "shared-tools":
      return <SharedToolsDialog onClose={closeDialog} />
    case "reference":
      return <ReferenceDialog plateId={dialog.plateId} onClose={closeDialog} />
    case "anchor-calibration":
      return <AnchorCalibrationDialog onClose={closeDialog} />
    case "z-probe":
      return <ZProbeDialog job={dialog.job} onClose={closeDialog} />
    case "point-actions":
      return <PointActionsDialog intent={dialog.intent} onClose={closeDialog} />
    case "probe-diameter-calibration":
      return <ProbeDiameterCalibrationDialog onClose={closeDialog} />
    case "processes":
      return <ProcessDialog onClose={closeDialog} />
    case "measurement-setup":
      return (
        <MeasurementSetup
          key={`${dialog.session.runId}-${dialog.feature.operationId}`}
          session={dialog.session}
          feature={dialog.feature}
          onClose={closeDialog}
        />
      )
    case "facing":
      return (
        <FacingDialog
          key={`${dialog.plateId}-${dialog.operationId}`}
          plateId={dialog.plateId}
          operationId={dialog.operationId}
          onClose={closeDialog}
        />
      )
    case "guided-setup":
      return <GuidedSetup onClose={closeDialog} />
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
    case "models": {
      const { back } = dialog
      return (
        <ModelsDialog
          onClose={() => (back ? openDialog(back) : closeDialog())}
        />
      )
    }
    case "fixture-definition":
      return <FixtureDefinitionDialog dialog={dialog} onClose={closeDialog} />
    case "device-configuration":
      return <DeviceConfigurationDialog onClose={closeDialog} />
    case "height-map":
      return <HeightMapDialog onClose={closeDialog} />
    case "set-origin":
      return <SetOriginDialog onClose={closeDialog} />
    case "stock":
      return <StockDialog plateId={dialog.plateId} onClose={closeDialog} />
    case "add-fixture":
      return <AddFixtureDialog plateId={dialog.plateId} onClose={closeDialog} />
    case "tools":
      return (
        <WorkspaceToolLibrary
          assign={dialog.assign}
          onClose={() =>
            dialog.back ? openDialog(dialog.back) : closeDialog()
          }
        />
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
    case "probing":
      return <ProbingPicker onClose={closeDialog} />
    case "inspection":
      return (
        <InspectionWizard
          key={dialog.recipe}
          recipe={dialog.recipe}
          onClose={closeDialog}
        />
      )
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
  return dialog && !isGuideDialog(dialog) && <OpenDialog dialog={dialog} />
}

/** A guide is part of the workspace layout, with no overlay or focus trap. */
export function GuideHost() {
  const dialog = useOpenDialog()
  if (!dialog || !isGuideDialog(dialog)) return null
  return (
    <GuidePanelContext.Provider value>
      <OpenDialog dialog={dialog} />
    </GuidePanelContext.Provider>
  )
}
