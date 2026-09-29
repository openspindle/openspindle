import { Menu, app, dialog, net } from "electron"
import type { BrowserWindow } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { configureAboutPanel } from "./about"
import { Diagnostics, appInfo } from "./diagnostics/diagnostics"
import { ErrorReports } from "./diagnostics/error-reports"
import { log } from "./diagnostics/log"
import { DiagnosticsSettingsStore } from "./diagnostics/settings"
import { LastDevice } from "./machine/last-device"
import { MachineHost } from "./machine/machine-host"
import { MACHINE_STOP_ITEM, buildApplicationMenu } from "./menu"
import { lockPluginFrames } from "./plugins/frame-security"
import { PluginPlatform } from "./plugins/platform"
import { handleAppProtocol, registerAppScheme } from "./protocol"
import { createHostHandlers } from "./rpc/host-handlers"
import { serveHostConnections } from "./rpc/host-server"
import { FileService } from "./services/file-service"
import { FusionService } from "./services/fusion-service"
import { KeptWorkspace } from "./services/kept-workspace"
import { MenuBus } from "./services/menu-bus"
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
/** The plugins that come with the app: packaged apps carry them among their resources. */
const BUNDLED_PLUGINS = app.isPackaged
  ? path.join(process.resourcesPath, "plugins")
  : fileURLToPath(new URL("../plugins", import.meta.url))
/** Packaged apps carry their icon; dev and preview runs start Electron's own bundle. */
const DEV_ICON = app.isPackaged
  ? undefined
  : fileURLToPath(new URL("../../build/icon.png", import.meta.url))

registerAppScheme()
app.setName("OpenSpindle")
// Dev runs keep their data, and their log, apart from the installed app's.
if (!app.isPackaged) {
  app.setPath("userData", `${app.getPath("userData")}-dev`)
  app.setAppLogsPath(path.join(app.getPath("userData"), "logs"))
}

let mainWindow: BrowserWindow | null = null
const currentWindow = () =>
  mainWindow && !mainWindow.isDestroyed() ? mainWindow : null

// One instance owns the discovery port and the machine connection.
if (!app.requestSingleInstanceLock()) app.quit()
else {
  const diagnostics = startDiagnostics()
  app.on("second-instance", () => {
    const window = currentWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  void app
    .whenReady()
    .then(() => start(diagnostics))
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

function start(diagnostics: Diagnostics) {
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
  const fusion = new FusionService()
  fusion.start()
  const machine = new MachineHost(
    (snapshot) => {
      const stop =
        Menu.getApplicationMenu()?.getMenuItemById(MACHINE_STOP_ITEM) ?? null
      if (stop) stop.enabled = snapshot.availability.stop.allowed
    },
    new LastDevice(app.getPath("userData"))
  )
  const entry = rendererEntry()
  const pluginPlatform = new PluginPlatform({
    userData: app.getPath("userData"),
    temp: app.getPath("temp"),
    bundled: BUNDLED_PLUGINS,
    machine: machine.controller,
    window: currentWindow,
    fetch: (input, init) => net.fetch(input, init),
  })
  serveHostConnections({
    handlers: createHostHandlers({
      files,
      fusion,
      menu,
      machine: machine.app,
      storage,
      models,
      pluginPlatform,
      unsaved,
      keptWorkspace,
      diagnostics,
    }),
    isTrusted: trustedSender(currentWindow, entry.origin),
  })
  const updates = new AppUpdates(currentWindow)
  Menu.setApplicationMenu(
    buildApplicationMenu(
      menu,
      {
        stop: () => {
          machine.system.stop().catch((error: unknown) => {
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
      { exportLog: () => void diagnostics.exportLogFromMenu(files) }
    )
  )
  updates.start()

  // The renderer flushes its last saves as the window closes; let them land first.
  let storageSettled = false
  app.on("will-quit", (event) => {
    if (storageSettled) {
      fusion.dispose()
      machine.dispose()
      pluginPlatform.dispose()
      log.info("OpenSpindle quit")
      log.flushSync()
      return
    }
    event.preventDefault()
    void storage.idle().finally(() => {
      storageSettled = true
      // From a later task: with nothing left to write, idle() settles while this event is still
      // being emitted, and until it returns Electron ignores app.quit() as already quitting.
      setImmediate(() => app.quit())
    })
  })

  mainWindow = createMainWindow({ preload: PRELOAD, entry, icon: DEV_ICON })
  lockPluginFrames(mainWindow, entry.origin)
  const window = mainWindow
  // Closing the window quits the app, and every quit closes the window first, so the window
  // asks before it closes: about unsaved changes, then about a running job, which quitting
  // leaves running. It asks in sheets, which leave the main process running (the machine
  // connection polls on it): the close waits for the answers, and happens again once the user
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
  // The only thing a launch restores: the connection to the last used device.
  void machine.reconnect()
}
