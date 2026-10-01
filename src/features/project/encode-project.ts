import type { WorkspaceState } from "@/domain/workspace/workspace"
import { projectDocument } from "@/formats/project/document"
import { encodeProject } from "@/formats/project/project"
import type { Host } from "@/platform/host"
import { projectModels } from "./project-models"

/**
 * The workspace as the contents of a STEP-NC project file, as Save Project writes it, with
 * how many of its fixtures' models it lacks.
 */
export async function encodeWorkspace(state: WorkspaceState, host: Host) {
  const { models, missing } = await projectModels(state.plates, host.models)
  const contents = encodeProject(projectDocument(state, models))
  return { contents, missing }
}
