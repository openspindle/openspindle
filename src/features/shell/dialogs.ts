import { createAtom, useSelector } from "@tanstack/react-store"
import type { PluginSourceRef } from "@/features/plugins/plugin-sources"
import type { ProjectCandidate } from "@/features/project/use-project"

/** Every dialog of the workspace. One is open at a time; the dialog host renders it. */
export type WorkspaceDialog =
  | { readonly kind: "device" }
  | { readonly kind: "plugins" }
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
      /** Opens a plugin's template form or importer view directly. */
      readonly preset?: PluginSourceRef
    }
  /** Starting a new project over unsaved changes: save them, discard them, or cancel. */
  | { readonly kind: "new-project" }
  /** Opening a project over unsaved changes: save them, discard them, or cancel. */
  | { readonly kind: "open-project"; readonly candidate: ProjectCandidate }
  /** What opening a project converted or left out, and plugins it needs that are not installed. */
  | { readonly kind: "project-report"; readonly report: ProjectCandidate }
  /** The project's settings, such as its design rules. */
  | { readonly kind: "workspace-settings" }

const dialogAtom = createAtom<WorkspaceDialog | null>(null)

export const openDialog = (dialog: WorkspaceDialog) =>
  dialogAtom.set(() => dialog)
export const closeDialog = () => dialogAtom.set(() => null)
export const useOpenDialog = () => useSelector(dialogAtom)
/** The open dialog, for handlers that run outside rendering (menu commands). */
export const currentDialog = () => dialogAtom.get()
