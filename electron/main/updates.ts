import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { Menu, Notification, app, dialog, shell } from "electron"
import type { BrowserWindow, MessageBoxOptions } from "electron"
import electronUpdater from "electron-updater"
import type { UpdateInfo } from "electron-updater"
import { log } from "./diagnostics/log"
import { UPDATE_CHECK_ITEM, UPDATE_INSTALL_ITEM } from "./menu"
import { releaseNotesText } from "./release-notes"

const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60_000
/** electron-builder writes it into packaged apps when it knows the release repository. */
const feedFile = () => path.join(process.resourcesPath, "app-update.yml")

/**
 * Packaged apps update themselves from the GitHub releases the release workflow publishes
 * (docs/releasing.md). They check shortly after launch and every four hours, download a newer
 * version in the background and install it when the app quits; a notification says when one
 * is ready. The app menu's Check for Updates… says what it finds, and Restart to Install
 * Update… shows the release notes, then quits through the same prompts as any quit (a running
 * job, unsaved changes) and relaunches the new version. Dev runs, and builds made without a
 * release repository (no app-update.yml among their resources), do not update: Check for
 * Updates… says so.
 */
export class AppUpdates {
  readonly enabled = app.isPackaged && existsSync(feedFile())
  private ready: UpdateInfo | null = null
  private checking = false
  /** A menu check found an update: offer to restart once it has downloaded. */
  private offerWhenReady = false
  /** Kept so that its click handler lives as long as the notification. */
  private notification: Notification | null = null

  constructor(private readonly window: () => BrowserWindow | null) {}

  start() {
    if (!this.enabled) return
    const { autoUpdater } = electronUpdater
    // What it checks, finds and downloads goes to the app's log.
    autoUpdater.logger = {
      error: (message: unknown) => log.error(String(message)),
      warn: (message: unknown) => log.warn(String(message)),
      info: (message: unknown) => log.info(String(message)),
      debug: (message: string) => log.debug(message),
    }
    // Without a listener an "error" event would throw; a failed check waits for the next one.
    // The logger has recorded it.
    autoUpdater.on("error", () => undefined)
    autoUpdater.on("update-downloaded", (info) => {
      this.ready = info
      this.refreshMenu()
      if (this.offerWhenReady) {
        this.offerWhenReady = false
        void this.offerInstall(info)
      } else this.notify(info)
    })
    const check = () => {
      if (this.ready || this.checking) return
      // A failed download, like a failed check, waits for the next check.
      autoUpdater
        .checkForUpdates()
        .then((result) => result?.downloadPromise)
        .catch(() => undefined)
    }
    setTimeout(check, FIRST_CHECK_DELAY_MS)
    setInterval(check, CHECK_INTERVAL_MS)
  }

  /** App menu › Check for Updates…: checks now and says what it found. */
  async check(): Promise<void> {
    if (!this.enabled) {
      await this.inform({
        message: "This copy of Spinnvill does not update itself.",
        detail: app.isPackaged
          ? "It was built without a release repository to check. Copies installed from Spinnvill's releases update themselves."
          : "Development runs do not check for updates. Copies installed from Spinnvill's releases update themselves.",
      })
      return
    }
    if (this.checking) return
    if (this.ready) return this.offerInstall(this.ready)
    this.checking = true
    this.refreshMenu()
    try {
      const result = await electronUpdater.autoUpdater.checkForUpdates()
      if (result?.isUpdateAvailable) {
        this.offerWhenReady = true
        // A failed download is logged, and a later one only notifies.
        void result.downloadPromise?.catch(() => {
          this.offerWhenReady = false
        })
        await this.inform({
          message: `Spinnvill ${result.updateInfo.version} is downloading.`,
          detail:
            "You can keep working: Spinnvill offers to restart once it has downloaded, and installs it when you quit.",
        })
      } else {
        await this.inform({
          message: "Spinnvill is up to date.",
          detail: `Version ${app.getVersion()} is the latest.`,
        })
      }
    } catch (error) {
      await this.inform({
        type: "warning",
        message: "Spinnvill could not check for updates.",
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.checking = false
      this.refreshMenu()
    }
  }

  /** App menu › Restart to Install Update…: the release notes, then a restart if asked. */
  install() {
    if (this.ready) void this.offerInstall(this.ready)
  }

  private async offerInstall(info: UpdateInfo) {
    const notes = releaseNotesText(info.releaseNotes)
    const page = this.releasePage(info.version)
    const response = await this.inform({
      message: `Spinnvill ${info.version} is ready to install.`,
      detail: [
        notes,
        "Restart now to install it, or it installs the next time you quit Spinnvill.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      buttons: ["Restart Now", "Later", ...(page ? ["Release Notes"] : [])],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) electronUpdater.autoUpdater.quitAndInstall()
    else if (response === 2 && page) void shell.openExternal(page)
  }

  private notify(info: UpdateInfo) {
    if (!Notification.isSupported()) return
    this.notification = new Notification({
      title: `Spinnvill ${info.version} is ready`,
      body: "It installs when you quit. Click to see what's new, or to restart now.",
    })
    this.notification.on("click", () => void this.offerInstall(info))
    this.notification.show()
  }

  /** The release's page, when the feed is a GitHub repository's releases. */
  private releasePage(version: string): string | undefined {
    try {
      const feed = Object.fromEntries(
        readFileSync(feedFile(), "utf8")
          .split("\n")
          .flatMap((line) => {
            const entry = /^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/.exec(line)
            return entry ? [[entry[1], entry[2]] as const] : []
          })
      )
      return feed.provider === "github" && feed.owner && feed.repo
        ? `https://github.com/${feed.owner}/${feed.repo}/releases/tag/v${version}`
        : undefined
    } catch {
      return undefined
    }
  }

  private async inform(
    options: Omit<MessageBoxOptions, "message"> & { message: string }
  ): Promise<number> {
    const box: MessageBoxOptions = { type: "info", buttons: ["OK"], ...options }
    const window = this.window()
    const { response } = window
      ? await dialog.showMessageBox(window, box)
      : await dialog.showMessageBox(box)
    return response
  }

  private refreshMenu() {
    const menu = Menu.getApplicationMenu()
    const check = menu?.getMenuItemById(UPDATE_CHECK_ITEM)
    if (check) {
      check.visible = this.ready === null
      check.enabled = !this.checking
    }
    const install = menu?.getMenuItemById(UPDATE_INSTALL_ITEM)
    if (install) install.visible = this.ready !== null
  }
}
