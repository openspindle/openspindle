import { dialog } from "electron"
import type { BrowserWindow } from "electron"
import type { MenuBus } from "./menu-bus"

/**
 * The project's unsaved changes, as the renderer reports them. The workspace is not kept
 * between launches, so closing the window with unsaved changes asks first.
 */
export class UnsavedChanges {
  private edited = false
  private name = ""
  /** The renderer saved the changes and closes the window itself. */
  private approved = false
  private readonly window: () => BrowserWindow | null
  private readonly menu: MenuBus

  constructor(window: () => BrowserWindow | null, menu: MenuBus) {
    this.window = window
    this.menu = menu
  }

  /** Whether closing the window asks about unsaved changes first. */
  get pending(): boolean {
    return this.edited && !this.approved
  }

  report(edited: boolean, name: string) {
    this.edited = edited
    this.name = name
    if (edited) this.approved = false
    // macOS marks the close button of a window with unsaved changes.
    this.window()?.setDocumentEdited(edited)
    this.window()?.setTitle(
      `${!name || edited ? "*" : ""}${name || "Untitled"} — OpenSpindle`
    )
  }

  /** Closes the window without asking about its changes again: they were saved. */
  close() {
    this.approved = true
    this.window()?.close()
  }

  /**
   * Whether the window may close now. Save asks the renderer to save the project; it closes
   * the window once the project is saved. It asks in a sheet on the window, which leaves the
   * main process running.
   */
  async confirmClose(window: BrowserWindow): Promise<boolean> {
    if (!this.pending) return true
    const { response } = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["Save…", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      message: `Do you want to save the changes to “${this.name || "Untitled"}”?`,
      detail:
        "OpenSpindle starts with a new project next time, so changes you don't save are lost.",
    })
    if (response === 1) return true
    if (response === 0) this.menu.emit("project.saveAndClose")
    return false
  }
}
