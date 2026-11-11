import { createAtom, useSelector } from "@tanstack/react-store"
import type { ImportPlan } from "@/app/workspace/import-plan"
import type { ProjectCandidate } from "@/features/project/use-project"
import type { SettingsSection } from "@/features/settings/settings-dialog"
import type { InspectionRecipe } from "@/domain/probing/inspection-recipes"
import type { InspectionFeature } from "@/domain/probing/metrology"
import type { JobSession } from "@/features/job/job-session"
import type { ZProbeJob } from "@/features/job/z-probe-job"
import type { PointIntent } from "@/features/prepare/point-intent"

/** Every dialog of the workspace. One is open at a time; the dialog host renders it. */
export type WorkspaceDialog =
  | { readonly kind: "guided-setup" }
  | { readonly kind: "processes" }
  | {
      readonly kind: "measurement-setup"
      readonly session: JobSession
      readonly feature: InspectionFeature
    }
  | {
      readonly kind: "facing"
      readonly plateId?: string
      readonly operationId?: string
    }
  | { readonly kind: "device" }
  | { readonly kind: "anchor-calibration" }
  | { readonly kind: "z-probe"; readonly job?: ZProbeJob }
  | { readonly kind: "probe-diameter-calibration" }
  | { readonly kind: "point-actions"; readonly intent: PointIntent }
  | { readonly kind: "device-configuration" }
  /** The Models library; closing it goes back to the dialog it opened from. */
  | { readonly kind: "models"; readonly back?: WorkspaceDialog }
  | { readonly kind: "height-map" }
  | { readonly kind: "set-origin" }
  | { readonly kind: "fusion" }
  | {
      readonly kind: "fusion-pairing"
      readonly requestId: string
      readonly returnToFusion: boolean
    }
  | { readonly kind: "stock"; readonly plateId: string }
  /** A fixture definition of a bed setup of a device's profile, edited. */
  | {
      readonly kind: "fixture-definition"
      readonly profileId: string
      readonly bedSetupId: string
      readonly definitionId: string
    }
  /** A fixture of the plate's bed setup to add to it, chosen by its picture. */
  | { readonly kind: "add-fixture"; readonly plateId: string }
  | {
      readonly kind: "tools"
      readonly back?: WorkspaceDialog
      /** Assigning a plate's tool table entry; the library is only managed otherwise. */
      readonly assign?: {
        readonly plateId: string
        readonly number: number | null
      }
    }
  | {
      readonly kind: "source"
      readonly plateId: string
      readonly operationId: string | null
    }
  | {
      readonly kind: "add-operation"
      /** Opens the PCB importer directly. */
      readonly preset?: "pcb"
    }
  /** A probing operation from a strategy and a probe of the tool library that performs it. */
  | { readonly kind: "probing" }
  | { readonly kind: "inspection"; readonly recipe: InspectionRecipe }
  /** Starting a new project over unsaved changes: save them, discard them, or cancel. */
  | { readonly kind: "new-project" }
  /** Opening a project over unsaved changes: save them, discard them, or cancel. */
  | { readonly kind: "open-project"; readonly candidate: ProjectCandidate }
  /** What opening a project converted or left out. */
  | { readonly kind: "project-report"; readonly report: ProjectCandidate }
  /** The app's settings: appearance, PCB conversion, logging and error reports. */
  | { readonly kind: "settings"; readonly section?: SettingsSection }
  /** The project's settings, such as its design rules. */
  | { readonly kind: "workspace-settings" }
  /** The machine's G-code, code by code; closing it goes back to the dialog it opened from. */
  | { readonly kind: "gcode-glossary"; readonly back?: WorkspaceDialog }
  /** Files read for importing, and what to ask first: their plate, splits and issues. */
  | { readonly kind: "import"; readonly plan: ImportPlan }

const dialogAtom = createAtom<WorkspaceDialog | null>(null)

/** Guides share a docked workspace panel; confirmations and editors retain their modal guards. */
export function isGuideDialog(dialog: WorkspaceDialog | null): boolean {
  if (!dialog) return false
  return [
    "anchor-calibration",
    "z-probe",
    "point-actions",
    "probe-diameter-calibration",
    "guided-setup",
    "facing",
    "inspection",
    "probing",
    "measurement-setup",
    "processes",
  ].includes(dialog.kind)
}

export const openDialog = (dialog: WorkspaceDialog) =>
  dialogAtom.set(() => dialog)
export const closeDialog = () => dialogAtom.set(() => null)
export const useOpenDialog = () => useSelector(dialogAtom)
/** The open dialog, for handlers that run outside rendering (menu commands). */
export const currentDialog = () => dialogAtom.get()
