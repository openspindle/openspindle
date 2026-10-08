import { dialog } from "electron"
import type {
  BrowserWindow,
  OpenDialogOptions,
  SaveDialogOptions,
} from "electron"
import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { RpcError } from "@openspindle/rpc"
import {
  FILE_KINDS,
  hasFileExtension,
  validateOpenedFile,
} from "../../../src/platform/contract/files"
import type {
  FileKind,
  LinkedFileRead,
  LinkedFileRequest,
  LinkedFileStatus,
  OpenFileResult,
  SaveFileRequest,
  SaveFileResult,
} from "../../../src/platform/contract/files"
import { writeFileAtomic } from "./atomic-write"

/**
 * Reads a file of a kind as the app opens it: a file within the kind's size limit, of UTF-8
 * text the kind accepts. Throws, saying why, otherwise.
 */
export async function readKindFile(
  kind: FileKind,
  filePath: string
): Promise<{ fileName: string; contents: string }> {
  const spec = FILE_KINDS[kind]
  const fileName = path.basename(filePath)
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error(`${fileName} is not a file.`)
  if (info.size > spec.maxBytes)
    throw new Error(`${fileName} exceeds the file size limit.`)
  let contents: string
  try {
    contents = new TextDecoder("utf-8", { fatal: true }).decode(
      await readFile(filePath)
    )
  } catch {
    throw new Error(`${fileName} is not valid UTF-8 text.`)
  }
  return validateOpenedFile(kind, fileName, contents)
}

/**
 * A linked file read as `readKindFile` reads it, with when it was last modified. The path must
 * be absolute and of the kind's extensions: the renderer asks only for files the user chose,
 * and gets no other file read this way.
 */
async function readLinkedFile(
  request: LinkedFileRequest
): Promise<LinkedFileRead> {
  const { kind, path: filePath } = request
  if (!path.isAbsolute(filePath) || !hasFileExtension(kind, filePath))
    throw new RpcError(
      "INVALID_PARAMS",
      `Only ${FILE_KINDS[kind].title} files can be linked.`
    )
  const { mtimeMs } = await stat(filePath)
  return { ...(await readKindFile(kind, filePath)), modifiedAt: mtimeMs }
}

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex")

/** Native open/save dialogs for every file kind; one dialog at a time. */
export class FileService {
  private dialogOpen = false

  constructor(private readonly window: () => BrowserWindow | null) {}

  open(kind: FileKind): Promise<OpenFileResult> {
    return this.exclusive(async () => {
      const spec = FILE_KINDS[kind]
      const options: OpenDialogOptions = {
        title: `Open ${spec.title}`,
        properties: ["openFile"],
        filters: [{ name: spec.title, extensions: [...spec.extensions] }],
      }
      const window = this.window()
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      const filePath = result.filePaths[0]
      if (result.canceled || !filePath) return { status: "canceled" }
      return { status: "opened", ...(await readKindFile(kind, filePath)) }
    })
  }

  save(request: SaveFileRequest): Promise<SaveFileResult> {
    return this.exclusive(async () => {
      const spec = FILE_KINDS[request.kind]
      const options: SaveDialogOptions = {
        title: `Save ${spec.title}`,
        defaultPath: request.suggestedName,
        filters: [{ name: spec.title, extensions: [...spec.saveExtensions] }],
      }
      const window = this.window()
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath)
        return { status: "canceled", fileName: request.suggestedName }
      const filePath = hasFileExtension(request.kind, result.filePath, "save")
        ? result.filePath
        : `${result.filePath}.${spec.saveExtensions[0]}`
      await writeFileAtomic(filePath, request.contents)
      return { status: "saved", fileName: path.basename(filePath) }
    })
  }

  /** How a linked file is on disk now, which no dialog holds up. */
  async linkedStatus(request: LinkedFileRequest): Promise<LinkedFileStatus> {
    try {
      const { contents, modifiedAt } = await readLinkedFile(request)
      return { status: "found", sha256: sha256(contents), modifiedAt }
    } catch (error) {
      if (error instanceof RpcError) throw error
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { status: "missing" }
      return {
        status: "unreadable",
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** A linked file's text, read again. */
  readLinked(request: LinkedFileRequest): Promise<LinkedFileRead> {
    return readLinkedFile(request)
  }

  private async exclusive<T>(run: () => Promise<T>): Promise<T> {
    if (this.dialogOpen)
      throw new RpcError("BUSY", "A file dialog is already open.")
    this.dialogOpen = true
    try {
      return await run()
    } finally {
      this.dialogOpen = false
    }
  }
}
