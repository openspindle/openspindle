import { BrowserWindow, app, dialog } from "electron"
import { REPORT_LOG_BYTES } from "../../../src/platform/contract/diagnostics"
import type {
  AppInfo,
  DiagnosticsSettings,
  DiagnosticsStatus,
  LogRecord,
} from "../../../src/platform/contract/diagnostics"
import type { SaveFileResult } from "../../../src/platform/contract/files"
import type { FileService } from "../services/file-service"
import type { ErrorReports } from "./error-reports"
import { log } from "./log"
import type { DiagnosticsSettingsStore } from "./settings"

const OS_NAMES: Readonly<Record<string, string>> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
}

export function appInfo(): AppInfo {
  const os = OS_NAMES[process.platform] ?? process.platform
  return {
    version: app.isPackaged ? app.getVersion() : `${app.getVersion()} (dev)`,
    electron: process.versions.electron,
    os: `${os} ${process.getSystemVersion()} (${process.arch})`,
  }
}

/**
 * An error the main process reports itself, in a sheet on the window: it leaves the process,
 * and the machine connection's polling on it, running. Without a window, the error box shows
 * instead, which works before the app is ready too; it blocks until closed, as every message
 * box without a window does on macOS.
 */
export function showErrorMessage(message: string, detail: string) {
  const window = BrowserWindow.getAllWindows().at(0)
  if (window)
    void dialog.showMessageBox(window, { type: "error", message, detail })
  else dialog.showErrorBox(message, detail)
}

/** The log, its settings and error reports, as the renderer and the Help menu reach them. */
export class Diagnostics {
  constructor(
    private readonly settings: DiagnosticsSettingsStore,
    readonly reports: ErrorReports
  ) {}

  status(): DiagnosticsStatus {
    return {
      settings: this.settings.get(),
      reporting: this.reports.reporting,
      app: appInfo(),
    }
  }

  async updateSettings(
    patch: Partial<DiagnosticsSettings>
  ): Promise<DiagnosticsSettings> {
    const next = await this.settings.update(patch)
    log.setLevel(next.logLevel)
    log.info(
      `Settings: debug level ${next.logLevel}, automatic error reports ${next.reportAutomatically ? "on" : "off"}`
    )
    return next
  }

  /** The renderer's records, as it logged them. */
  record(records: readonly LogRecord[]) {
    for (const { level, message, time } of records)
      log.write(level, "renderer", message, undefined, time)
  }

  readLog(): Promise<string> {
    return log.read(REPORT_LOG_BYTES)
  }

  /** Saves the whole log where the user chooses. */
  async exportLog(files: FileService): Promise<SaveFileResult> {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")
    return files.save({
      kind: "log",
      suggestedName: `spinnvill-${stamp}.log`,
      contents: await log.read(),
    })
  }

  /** Help › Export Log: it works without the renderer, and says in a message box if it fails. */
  async exportLogFromMenu(files: FileService) {
    try {
      await this.exportLog(files)
    } catch (error) {
      showErrorMessage(
        "The log was not exported",
        error instanceof Error ? error.message : String(error)
      )
    }
  }
}
