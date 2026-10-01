import {
  BrowserWindow,
  app,
  dialog,
  nativeTheme,
  session,
  shell,
} from "electron"
import type { BrowserWindowConstructorOptions, IpcMainEvent } from "electron"
import { APP_ORIGIN } from "../../src/platform/contract/channels"
import { log } from "./diagnostics/log"

/** Node's URL reports a "null" origin for custom schemes such as app://, so compare scheme and host. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

/** The dev server during `electron-vite dev`; the packaged renderer otherwise. */
export function rendererEntry(): { url: string; origin: string } {
  const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
  const devOrigin = devUrl ? originOf(devUrl) : null
  if (devUrl && devOrigin) return { url: devUrl, origin: devOrigin }
  return { url: `${APP_ORIGIN}/index.html`, origin: APP_ORIGIN }
}

const ALLOWED_EXTERNAL = /^https:\/\/github\.com\//

/** A page crashing this often within a minute is broken, not unlucky: stop reloading it. */
const CRASH_BUDGET = 3
const CRASH_BUDGET_WINDOW_MS = 60_000

const APP_PERMISSIONS: ReadonlySet<string> = new Set([
  "fullscreen",
  "clipboard-sanitized-write",
])

/**
 * Session-wide defaults: only the main frame may use fullscreen and clipboard writes;
 * no webviews or new windows.
 */
export function hardenSessions() {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, permission, callback, details) =>
      callback(details.isMainFrame && APP_PERMISSIONS.has(permission))
  )
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission, _origin, details) =>
      details.isMainFrame && APP_PERMISSIONS.has(permission)
  )
  app.on("web-contents-created", (_event, contents) => {
    contents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp")
    contents.setWebRTCUDPPortRange({ min: 1, max: 1 })
    contents.on("will-frame-navigate", (event) => {
      if (!event.isMainFrame) event.preventDefault()
    })
    contents.on("will-attach-webview", (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      if (ALLOWED_EXTERNAL.test(url)) void shell.openExternal(url)
      return { action: "deny" }
    })
  })
}

/**
 * macOS draws the page under a transparent title bar. The 14px traffic lights sit centered in
 * the 32px workspace header; the overlay reports their area to CSS as env(titlebar-area-*).
 */
const MAC_TITLE_BAR: BrowserWindowConstructorOptions = {
  titleBarStyle: "hidden",
  trafficLightPosition: { x: 9, y: 9 },
  titleBarOverlay: true,
}

export function createMainWindow(options: {
  preload: string
  entry: { url: string; origin: string }
  /** Windows and Linux; macOS shows the app's icon. Unset, the executable's icon. */
  icon?: string
}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: "OpenSpindle",
    icon: options.icon,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    ...(process.platform === "darwin" ? MAC_TITLE_BAR : {}),
    webPreferences: {
      preload: options.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  })
  window.once("ready-to-show", () => window.show())
  window.webContents.on("will-navigate", (event, url) => {
    if (originOf(url) !== options.entry.origin) event.preventDefault()
  })
  // A page whose crash is deterministic (a bug, not bad luck) would otherwise reload forever.
  const recentCrashes: number[] = []
  window.webContents.on("render-process-gone", (_event, details) => {
    const now = Date.now()
    while (
      recentCrashes.length &&
      now - recentCrashes[0] > CRASH_BUDGET_WINDOW_MS
    )
      recentCrashes.shift()
    recentCrashes.push(now)
    if (recentCrashes.length > CRASH_BUDGET) {
      log.error(
        `The window's renderer is gone (${details.reason}, exit code ${details.exitCode}); it crashed too often to keep reloading`
      )
      dialog.showErrorBox(
        "OpenSpindle keeps crashing",
        "The window's page crashed repeatedly and was not reloaded again. Restart OpenSpindle to try again."
      )
      return
    }
    log.error(
      `The window's renderer is gone (${details.reason}, exit code ${details.exitCode}); reloading it`
    )
    if (!window.isDestroyed()) window.reload()
  })
  window.on("unresponsive", () => log.warn("The window stopped responding"))
  window.on("responsive", () => log.info("The window responds again"))
  void window.loadURL(options.entry.url)
  return window
}

/** Only the app document itself may reach the host API; never frames or other origins. */
export function trustedSender(
  window: () => BrowserWindow | null,
  origin: string
): (event: IpcMainEvent) => boolean {
  return (event) => {
    const current = window()
    const frame = event.senderFrame
    return (
      current !== null &&
      frame !== null &&
      event.sender === current.webContents &&
      frame.parent === null &&
      frame.origin === origin
    )
  }
}
