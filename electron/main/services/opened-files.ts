import path from "node:path"
import {
  MAX_OPENED_FILES,
  hasFileExtension,
} from "../../../src/platform/contract/files"
import type { OpenedFiles } from "../../../src/platform/contract/files"
import { readKindFile } from "./file-service"

/** Finder opens several files one event each, back to back: those this close are one batch. */
const BATCH_MS = 150

/** The kind a file opens as, by its name: an NC program or a project; null for neither. */
function openedKind(fileName: string): "program" | "project" | null {
  if (hasFileExtension("program", fileName)) return "program"
  if (hasFileExtension("project", fileName)) return "project"
  return null
}

/** Reads files the system asked the app to open; one that cannot be read says why. */
async function readOpenedFiles(paths: readonly string[]): Promise<OpenedFiles> {
  const opened: OpenedFiles = { files: [], problems: [] }
  for (const filePath of paths.slice(0, MAX_OPENED_FILES)) {
    const fileName = path.basename(filePath) || filePath
    const kind = openedKind(fileName)
    if (!kind) {
      opened.problems.push({
        fileName,
        message: "OpenSpindle opens NC programs and STEP-NC projects.",
      })
      continue
    }
    try {
      opened.files.push({ kind, ...(await readKindFile(kind, filePath)) })
    } catch (error) {
      opened.problems.push({
        fileName,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return opened
}

/**
 * Files the system asks the app to open: Finder's Open With, a double-click on a file the app
 * is the default for, or a drop on its Dock icon. They are read here and handed to the window,
 * which takes them as it takes dropped files; files opened together arrive together. Files
 * opened before a window listens, such as those that launched the app, wait for it.
 */
export class OpenedFileBus {
  private readonly listeners = new Set<(files: OpenedFiles) => void>()
  private readonly pending: OpenedFiles[] = []
  private paths: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  open(filePath: string) {
    this.paths.push(filePath)
    this.timer ??= setTimeout(() => void this.flush(), BATCH_MS)
  }

  subscribe(listener: (files: OpenedFiles) => void): () => void {
    this.listeners.add(listener)
    for (const files of this.pending.splice(0)) listener(files)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private async flush() {
    this.timer = null
    const paths = this.paths
    this.paths = []
    const files = await readOpenedFiles(paths)
    if (!this.listeners.size) {
      this.pending.push(files)
      return
    }
    for (const listener of this.listeners) listener(files)
  }
}
