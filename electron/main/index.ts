import { Menu, app, dialog } from "electron"
import type { BrowserWindow } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { configureAboutPanel, openCredits } from "./about"
import { Diagnostics, appInfo } from "./diagnostics/diagnostics"
import { ErrorReports } from "./diagnostics/error-reports"
import { log } from "./diagnostics/log"
import { DiagnosticsSettingsStore } from "./diagnostics/settings"
import { MachineHost } from "./machine/machine-host"
import { SimulatorService } from "./simulator/simulator-service"
import { MACHINE_STOP_ITEM, buildApplicationMenu } from "./menu"
import { PcbService } from "./pcb/service"
import { handleAppProtocol, registerAppScheme } from "./protocol"
import { createHostHandlers } from "./rpc/host-handlers"
import { sendPort, serveHostConnections } from "./rpc/host-server"
import { FileService } from "./services/file-service"
import { storedFusionCredentials } from "./services/fusion-credentials"
import { FusionService } from "./services/fusion-service"
import { KeptWorkspace } from "./services/kept-workspace"
import { MenuBus } from "./services/menu-bus"
import { OpenedFileBus } from "./services/opened-files"
import { UnsavedChanges } from "./services/unsaved-changes"
import { createModelLibrary } from "./services/model-service"
import { StorageService } from "./services/storage-service"
import { AppUpdates } from "./updates"
import {
  createMainWindow,
  hardenSessions,
  rendererEntry,
  trustedSender,
} from "./window"

const RENDERER_ROOT = fileURLToPath(new URL("../renderer", import.meta.url))
const PRELOAD = fileURLToPath(new URL("../preload/index.cjs", import.meta.url))
/** Packaged apps carry their icon; dev and preview runs start Electron's own bundle. */
const DEV_ICON = app.isPackaged
  ? undefined
  : fileURLToPath(new URL("../../build/icon.png", import.meta.url))

registerAppScheme()
app.setName("OpenSpindle")
// Windows shows a notification only for an app whose ID its Start menu shortcut carries: the
// installer gives the shortcut electron-builder.yml's appId.
if (process.platform === "win32")
  app.setAppUserModelId("com.openspindle.desktop")
// Dev runs keep their data, and their log, apart from the installed app's.
if (!app.isPackaged) {
  app.setPath("userData", `${app.getPath("userData")}-dev`)
  app.setAppLogsPath(path.join(app.getPath("userData"), "logs"))
}

let mainWindow: BrowserWindow | null = null
const currentWindow = () =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow : null

/**
 * Files Windows asks the app to open (Explorer's Open with, a double-click) arrive on the
 * command line: the app's own when they launch it, a second instance's when it runs. Chromium
 * may add switches to a second instance's, and dev runs start Electron with the app's folder.
 */
function filesInArgs(argv: readonly string[]): string[] {
  if (process.platform === "darwin") return []
  return argv
    .slice(process.defaultApp ? 2 : 1)
    .filter((arg) => !arg.startsWith("-") && path.isAbsolute(arg))
}

// One instance owns the discovery port and the machine connection.
if (!app.requestSingleInstanceLock()) app.quit()
else {
  const diagnostics = startDiagnostics()
  const openedFiles = new OpenedFileBus()
  for (const filePath of filesInArgs(process.argv)) openedFiles.open(filePath)
  app.on("second-instance", (_event, argv) => {
    for (const filePath of filesInArgs(argv)) openedFiles.open(filePath)
    const window = currentWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  // Files macOS asks the app to open (Finder's Open With, a double-click, the Dock icon). Those
  // that launch the app arrive before it is ready, so this listens from the start; the window
  // takes them once it listens.
  app.on("open-file", (event, filePath) => {
    event.preventDefault()
    openedFiles.open(filePath)
    currentWindow()?.focus()
  })
  void app
    .whenReady()
    .then(() => start(diagnostics, openedFiles))
    .catch((error: unknown) => {
      log.error("OpenSpindle failed to start", error)
      dialog.showErrorBox(
        "OpenSpindle failed to start",
        error instanceof Error ? error.message : String(error)
      )
      app.quit()
    })
}

// No invisible session may outlive its window.
app.on("window-all-closed", () => app.quit())

/**
 * Before the app is ready, so that the log records the start and Sentry catches errors and
 * native crashes from the first moment (docs/architecture.md, Errors and logs).
 */
function startDiagnostics(): Diagnostics {
  const settings = new DiagnosticsSettingsStore(app.getPath("userData"))
  log.open(app.getPath("logs"), settings.get().logLevel, {
    echo: !app.isPackaged,
  })
  const reports = new ErrorReports(
    settings,
    import.meta.env.SENTRY_DSN || undefined
  )
  const { version, os, electron } = appInfo()
  log.info(`OpenSpindle ${version} started on ${os}, Electron ${electron}`)
  return new Diagnostics(settings, reports)
}

function start(diagnostics: Diagnostics, openedFiles: OpenedFileBus) {
  hardenSessions()
  handleAppProtocol(RENDERER_ROOT)
  if (DEV_ICON) app.dock?.setIcon(DEV_ICON)
  void configureAboutPanel()

  const menu = new MenuBus()
  const unsaved = new UnsavedChanges(currentWindow, menu)
  const keptWorkspace = new KeptWorkspace()
  const storage = new StorageService(app.getPath("userData"))
  const models = createModelLibrary(app.getPath("userData"))
  const files = new FileService(currentWindow)
  const fusion = new FusionService(
    storedFusionCredentials(
      path.join(app.getPath("userData"), "fusion-connection")
    )
  )
  fusion.start()
  const machine: MachineHost = new MachineHost({
    userData: app.getPath("userData"),
    reports: diagnostics.reports,
    onChange: (snapshot) => {
      const stop =
        Menu.getApplicationMenu()?.getMenuItemById(MACHINE_STOP_ITEM) ?? null
      if (stop) stop.enabled = snapshot.availability.stop.allowed
    },
    // The page reaches the machine process directly: it gets a port to the new one.
    onRestart: () => {
      const window = currentWindow()
      const port = window && machine.connectApp()
      if (window && port) sendPort(window.webContents, "machine", port)
    },
  })
  const simulator = new SimulatorService(app.getPath("userData"))
  // The only thing a launch restores is the connection to the last used device, which the
  // machine process tries as it starts: once the app's simulator, which it may be, listens.
  // That takes milliseconds; the window asks for its port to the machine process much later.
  void simulator.start().finally(() => machine.start())
  const entry = rendererEntry()
  const pcb = new PcbService(app.getPath("userData"), currentWindow)
  serveHostConnections({
    handlers: createHostHandlers({
      files,
      fusion,
      menu,
      openedFiles,
      storage,
      models,
      pcb,
      unsaved,
      keptWorkspace,
      diagnostics,
      simulator,
    }),
    isTrusted: trustedSender(currentWindow, entry.origin),
    machine: () => machine.connectApp(),
  })
  const updates = new AppUpdates(currentWindow)
  Menu.setApplicationMenu(
    buildApplicationMenu(
      menu,
      {
        stop: () => {
          machine.stop().catch((error: unknown) => {
            log.error("Machine Stop failed", error)
          })
        },
        exportTrace: () => void machine.exportTrace(files),
      },
      {
        enabled: updates.enabled,
        check: () => void updates.check(),
        install: () => updates.install(),
      },
      { exportLog: () => void diagnostics.exportLogFromMenu(files) },
      { openCredits: () => void openCredits() }
    )
  )
  updates.start()

  // The renderer flushes its last saves as the window closes; let them land first, and the
  // machine process close the connection.
  let storageSettled = false
  app.on("will-quit", (event) => {
    if (storageSettled) {
      fusion.dispose()
      machine.dispose()
      simulator.dispose()
      pcb.dispose()
      log.info("OpenSpindle quit")
      log.flushSync()
      return
    }
    event.preventDefault()
    void Promise.all([storage.idle(), pcb.idle(), machine.close()]).finally(
      () => {
        storageSettled = true
        // From a later task: with nothing left to write, idle() settles while this event is still
        // being emitted, and until it returns Electron ignores app.quit() as already quitting.
        setImmediate(() => app.quit())
      }
    )
  })

  mainWindow = createMainWindow({ preload: PRELOAD, entry, icon: DEV_ICON })
  const window = mainWindow
  // Closing the window quits the app, and every quit closes the window first, so the window
  // asks before it closes: about unsaved changes, then about a running job, which quitting
  // leaves running. It asks in sheets, which leave the main process running (the menu's Stop
  // goes out from it): the close waits for the answers, and happens again once the user
  // agreed. Save… closes the window once the project is saved, and a running job is asked
  // about then. Nothing is kept from a cancelled close: the next one asks again.
  let asking = false
  let closeApproved = false
  const askToClose = async () => {
    asking = true
    try {
      // The sheets need the window in view, also when it is minimized or the app hidden.
      if (window.isMinimized()) window.restore()
      window.show()
      if (!(await unsaved.confirmClose(window))) return
      if (!(await machine.confirmQuit(window))) return
      closeApproved = true
      window.close()
    } catch (error) {
      log.error("Asking before closing the window failed", error)
    } finally {
      asking = false
    }
  }
  window.on("close", (event) => {
    if (closeApproved || (!unsaved.pending && !machine.jobRunning)) return
    event.preventDefault()
    // Closing again while a question shows waits for its answer.
    if (!asking) void askToClose()
  })
  // A crashed page kept nothing newer: the reload that follows starts a new project.
  window.webContents.on("render-process-gone", () => keptWorkspace.forget())
}
