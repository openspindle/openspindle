/**
 * How plugin frames are hosted, shared by the frame runtime, its build, the app's frame
 * host and the desktop main process (which serves and locks the frames).
 */

/** The frame document, relative to the app origin; the runtime build writes it there. */
export const PLUGIN_FRAME_DIRECTORY = "plugin-frame"
export const PLUGIN_FRAME_PATH = `/${PLUGIN_FRAME_DIRECTORY}/index.html`

/** Opaque origin: scripts and forms, nothing else (no same-origin, popups or navigation). */
export const PLUGIN_FRAME_SANDBOX = "allow-scripts allow-forms"

/**
 * The frame document's policy: only the app's runtime files and the plugin bundle (a
 * blob: module) execute, styles and fonts come from the app, and the frame cannot connect
 * anywhere.
 */
export const PLUGIN_FRAME_CSP = [
  "default-src 'none'",
  "script-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ")

/** Header-only additions: only the app itself may embed a plugin frame. */
export const PLUGIN_FRAME_CSP_HEADER = `${PLUGIN_FRAME_CSP}; frame-ancestors 'self'`

/** Frame → app (window message): the runtime is loaded and waits for its port. */
export const FRAME_READY_MESSAGE = "openspindle:plugin-frame-ready"
/** App → frame (window message): carries the MessagePort the view contract runs on. */
export const FRAME_CONNECT_MESSAGE = "openspindle:plugin-frame-connect"
