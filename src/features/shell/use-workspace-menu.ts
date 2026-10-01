import { useNavigate, useRouter } from "@tanstack/react-router"
import {
  useNewProject,
  useOpenProject,
  useSaveProject,
} from "@/features/project/use-project"
import { usePersistence } from "@/persistence/persistence"
import { useHost, useMenuCommands } from "@/platform/host-context"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { changedAnchors } from "@/app/fixtures/fixture-library-store"
import {
  followDeviceAnchors,
  hasUnsavedChanges,
} from "@/app/workspace/project-session"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { currentDialog, openDialog } from "./dialogs"
import { useNativeImport } from "./use-native-import"

/** Input types that take typing, which Undo and Redo step through as in any text field. */
const TEXT_INPUTS = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
])

/** Whether the focused element takes typing, which Undo and Redo then step through. */
function editsText(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly
  if (element instanceof HTMLInputElement)
    return TEXT_INPUTS.has(element.type) && !element.readOnly
  return element instanceof HTMLElement && element.isContentEditable
}

/**
 * Undo and Redo of the section on show: the workspace's edits on Prepare and Job, the fixture
 * library's on Device. Plates set up for a device follow the anchors an undo or a redo there
 * restores, as they follow them when they are aligned.
 */
function useSectionHistory() {
  const router = useRouter()
  const workspace = useWorkspaceStore()
  const fixtures = useFixtureLibraryStore()
  return (step: "undo" | "redo") => {
    switch (router.state.location.pathname.split("/")[1]) {
      case "prepare":
      case "job":
        workspace[step]()
        return
      case "device": {
        const before = fixtures.state
        if (!fixtures[step]()) return
        const restored = changedAnchors(before, fixtures.state)
        for (const { deviceId, anchors } of restored)
          followDeviceAnchors(workspace, deviceId, anchors)
        return
      }
    }
  }
}

/** The application menu's workspace commands. */
export function useWorkspaceMenu() {
  const navigate = useNavigate()
  const workspace = useWorkspaceStore()
  const newProject = useNewProject()
  const openProject = useOpenProject()
  const saveProject = useSaveProject()
  const importProgram = useNativeImport()
  const persistence = usePersistence()
  const host = useHost()
  const stepHistory = useSectionHistory()
  useMenuCommands((command) => {
    // Closing with unsaved changes, the user chose Save: the save dialog does not replace an
    // open one, and the window closes once the project is saved and nothing changed meanwhile.
    if (command === "project.saveAndClose") {
      saveProject.mutate(undefined, {
        onSuccess: ({ result }) => {
          if (result.status === "saved" && !hasUnsavedChanges(workspace.state))
            host.window.close()
        },
      })
      return
    }
    // Typing is undone as in any text field, in a dialog too; the section's edits otherwise.
    if (
      (command === "edit.undo" || command === "edit.redo") &&
      editsText(document.activeElement)
    ) {
      document.execCommand(command === "edit.undo" ? "undo" : "redo")
      return
    }
    // Like a modal sheet, an open dialog holds the menu: a command would replace it and skip
    // its own guards (unsaved tool edits, a pending project choice). Until stored data has
    // loaded, or while its load issues wait for a decision, nothing may change it either.
    const settled = persistence.all.every(
      (document) => document.state.state.phase === "ready"
    )
    if (!settled || currentDialog() !== null) return
    switch (command) {
      case "settings.open":
        openDialog({ kind: "settings" })
        return
      case "models.manage":
        openDialog({ kind: "models" })
        return
      case "tools.manage":
        openDialog({ kind: "tools" })
        return
      case "glossary.open":
        openDialog({ kind: "gcode-glossary" })
        return
      case "program.import":
        void navigate({ to: "/prepare" })
        importProgram.mutate()
        return
      case "fusion.import":
        void navigate({ to: "/prepare" })
        openDialog({ kind: "fusion" })
        return
      case "project.new":
        newProject()
        return
      case "project.open":
        openProject.mutate({})
        return
      case "project.save":
        saveProject.mutate()
        return
      case "edit.undo":
        stepHistory("undo")
        return
      case "edit.redo":
        stepHistory("redo")
        return
    }
  })
}
