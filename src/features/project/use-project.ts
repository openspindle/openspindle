import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useFixtureLibraryStore } from "@/app/fixtures/fixture-context"
import { profilePlacement } from "@/app/fixtures/fixture-library-store"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import type { WorkspaceStore } from "@/app/workspace/store"
import type { WorkspaceState } from "@/domain/workspace/workspace"
import { libraryOf, openInLibrary } from "@/domain/workspace/library"
import { plural } from "@/domain/primitives"
import { projectWorkspace } from "@/formats/project/document"
import { decodeProject } from "@/formats/project/project"
import type { OpenedProject } from "@/formats/project/project"
import { openDialog } from "@/features/shell/dialogs"
import { WORKSPACE_MUTATION, workspaceScope } from "@/features/shell/use-import"
import { modelKeys } from "@/features/models/model-queries"
import type { ModelStore } from "@/persistence/models/model-library"
import {
  readProjectFile,
  suggestedProjectName,
} from "@/features/project/project-file"
import { useHost } from "@/platform/host-context"
import { encodeWorkspace } from "./encode-project"
import { addProjectModels } from "./project-models"
import {
  hasUnsavedChanges,
  markProjectSaved,
  sameProjectContents,
  startNewProject,
} from "@/app/workspace/project-session"

/** A decoded project, the file it came from and what opening it could not do. */
export type ProjectCandidate = OpenedProject & {
  readonly fileName: string
  readonly destinationId?: string
  /**
   * The project's models that the Models library did not take. Empty until `applyProject` adds
   * them: opening one is not final until then, so nothing is added to the library before that.
   */
  readonly notices: readonly string[]
}

/** Saved projects use the STEP-NC project extension, whatever they were opened as. */
const projectFileName = (fileName: string) =>
  fileName.replace(/\.(step|stp|p21)$/i, ".stpnc")

/**
 * Replaces the project with an opened one and reports what needs attention. The app's tool and
 * stock libraries stay: the tools its plates use that they lack are added. The project's models
 * are added to the Models library only now, once replacing the workspace is confirmed, so
 * cancelling an open over unsaved changes leaves the library untouched.
 */
export async function applyProject(
  workspace: WorkspaceStore,
  models: ModelStore,
  queryClient: QueryClient,
  candidate: ProjectCandidate,
  expected: WorkspaceState = workspace.state
) {
  const ensureUnchanged = () => {
    if (!sameProjectContents(workspace.state, expected))
      throw new Error(
        "The project changed while opening. Open the file again to review replacing those changes."
      )
  }
  ensureUnchanged()
  const notices = await addProjectModels(candidate.document.models, models)
  await queryClient.invalidateQueries({ queryKey: modelKeys.library })
  ensureUnchanged()
  const opened = openInLibrary(
    projectWorkspace(candidate.document, projectFileName(candidate.fileName)),
    libraryOf(workspace.state)
  )
  workspace.dispatch({ type: "workspace.replace", state: opened.state })
  if (/\.stpnc$/i.test(candidate.fileName))
    workspace.dispatch({
      type: "project.saved",
      fileName: candidate.fileName,
      destinationId: candidate.destinationId,
    })
  markProjectSaved(workspace.state)
  const added = opened.added
    ? `Added ${plural(opened.added, "tool")} its plates use to your tool library.`
    : undefined
  if (candidate.leftOut.length || notices.length) {
    openDialog({ kind: "project-report", report: { ...candidate, notices } })
    if (added) toast.info(added)
  } else
    toast.success(
      `Opened ${candidate.fileName}.`,
      added ? { description: added } : undefined
    )
}

/** Why a saved project lacks some of its fixtures' models; null when it has them all. */
function missingModelsNote(missing: number): string | null {
  if (!missing) return null
  if (missing === 1)
    return "1 fixture model is not in your Models library, so the project does not include it."
  return `${missing} fixture models are not in your Models library, so the project does not include them.`
}

/** Saves the workspace as a project file; resolves to whether it was written. */
export function useSaveProject() {
  const host = useHost()
  const workspace = useWorkspaceStore()
  return useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "save-project"],
    scope: workspaceScope,
    mutationFn: async (options?: { saveAs?: boolean }) => {
      const state = workspace.state
      const { contents, missing } = await encodeWorkspace(state, host)
      const result = await host.files.save({
        kind: "project",
        suggestedName: suggestedProjectName(state.project.fileName),
        destinationId: options?.saveAs
          ? undefined
          : state.project.fileDestination?.id,
        contents,
      })
      return { result, state, missing }
    },
    onSuccess: ({ result, state, missing }) => {
      if (result.status === "canceled") return
      workspace.dispatch({
        type: "project.saved",
        fileName: result.fileName,
        destinationId: result.destinationId,
      })
      markProjectSaved(state)
      const note = missingModelsNote(missing)
      toast.success(
        `Saved ${result.fileName}.`,
        note ? { description: note } : undefined
      )
    },
    onError: (error) => toast.error(error.message),
  })
}

/**
 * Opens a project file (dropped, or chosen in the host's dialog). With unsaved changes the
 * user decides first whether to save them.
 */
export function useOpenProject() {
  const host = useHost()
  const workspace = useWorkspaceStore()
  const apply = useApplyProject()
  return useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "open-project"],
    scope: workspaceScope,
    mutationFn: async ({
      file,
    }: {
      file?: File
    }): Promise<ProjectCandidate | null> => {
      let opened: { fileName: string; contents: string; destinationId?: string }
      if (file) opened = await readProjectFile(file)
      else {
        const result = await host.files.open("project")
        if (result.status === "canceled") return null
        opened = result
      }
      const decoded = decodeProject(opened.contents)
      if (!decoded.ok) throw new Error(decoded.error)
      // Models are added to the library only once opening is confirmed (applyProject), not here.
      return {
        ...decoded.value,
        notices: [],
        fileName: opened.fileName,
        destinationId: opened.destinationId,
      }
    },
    onSuccess: (candidate) => {
      if (!candidate) return
      if (hasUnsavedChanges(workspace.state))
        openDialog({ kind: "open-project", candidate })
      else apply.mutate({ candidate, expected: workspace.state })
    },
    onError: (error) => toast.error(error.message),
  })
}

/**
 * Opens a project once that is confirmed: its models join the library, then it replaces the
 * workspace. Runs in the workspace's mutation scope, so no save or import lands in between.
 */
export function useApplyProject() {
  const workspace = useWorkspaceStore()
  const host = useHost()
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "apply-project"],
    scope: workspaceScope,
    mutationFn: ({
      candidate,
      expected,
    }: {
      candidate: ProjectCandidate
      expected: WorkspaceState
    }) =>
      applyProject(workspace, host.models, queryClient, candidate, expected),
    onError: (error) => toast.error(error.message),
  })
}

/**
 * Replaces the project with the new one the app starts with, on the selected fixture profile.
 * Runs in the workspace's mutation scope, alongside open, save and import, so it never races
 * one of them.
 */
export function useStartNewProject() {
  const workspace = useWorkspaceStore()
  const fixtures = useFixtureLibraryStore()
  return useMutation({
    mutationKey: [...WORKSPACE_MUTATION, "new-project"],
    scope: workspaceScope,
    mutationFn: async (expected: WorkspaceState) => {
      if (!sameProjectContents(workspace.state, expected))
        throw new Error(
          "The project changed while waiting. Choose New Project again to review replacing those changes."
        )
      return startNewProject(workspace, profilePlacement(fixtures.state))
    },
    onSuccess: (result) => {
      if (!result.ok) toast.error(result.error)
    },
    onError: (error) => toast.error(error.message),
  })
}

/** Starts a new project. With unsaved changes the user decides first whether to save them. */
export function useNewProject() {
  const workspace = useWorkspaceStore()
  const start = useStartNewProject()
  return () => {
    if (hasUnsavedChanges(workspace.state)) openDialog({ kind: "new-project" })
    else start.mutate(workspace.state)
  }
}
