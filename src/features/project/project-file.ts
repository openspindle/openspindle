import { hasFileExtension, suggestedFileName } from "@/platform/contract/files"
import { readTextFile } from "@/platform/read-text-file"

export const isProjectFileName = (name: string) =>
  hasFileExtension("project", name)
export type OpenedProjectFile = {
  fileName: string
  contents: string
  destinationId?: string
}
const destinations = new WeakMap<File, string>()
export function rememberOpenedProject(file: File, destinationId?: string) {
  if (destinationId) destinations.set(file, destinationId)
  return file
}

export const suggestedProjectName = (name: string) =>
  suggestedFileName("project", name, "OpenSpindle project")

/**
 * Reads a project dropped onto the workspace; dialogs go through the host instead. Reads and
 * validates the file exactly as the host does when it opens one, so a project ⌘O refuses fails
 * the same way when it is dropped.
 */
export async function readProjectFile(file: File): Promise<OpenedProjectFile> {
  return {
    ...(await readTextFile("project", file)),
    destinationId: destinations.get(file),
  }
}
