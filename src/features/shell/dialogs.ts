import { createAtom, useSelector } from "@tanstack/react-store"
import type { ImportPlan } from "@/app/workspace/import-plan"
import type { ProjectCandidate } from "@/features/project/use-project"
import type { SettingsSection } from "@/features/settings/settings-dialog"

/** Every dialog of the workspace. One is open at a time; the dialog host renders it. */
export type WorkspaceDialog =
  | { readonly kind: "device" }
  | { readonly kind: "models" }
  | { readonly kind: "height-map" }
  | { readonly kind: "fusion" }
  | {
      readonly kind: "fusion-pairing"
      readonly requestId: string
      readonly returnToFusion: boolean
    }
  | { readonly kind: "stock"; readonly plateId: string }
  | {
      readonly kind: "tools"
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

export const openDialog = (dialog: WorkspaceDialog) =>
  dialogAtom.set(() => dialog)
export const closeDialog = () => dialogAtom.set(() => null)
export const useOpenDialog = () => useSelector(dialogAtom)
/** The open dialog, for handlers that run outside rendering (menu commands). */
export const currentDialog = () => dialogAtom.get()
