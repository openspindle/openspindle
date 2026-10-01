import { randomUUID } from "node:crypto"
import { app } from "electron"
import * as Sentry from "@sentry/electron/main"
import { errorSummary } from "../../../src/platform/contract/diagnostics"
import type { MainError } from "../../../src/platform/contract/diagnostics"
import { showErrorMessage } from "./diagnostics"
import { log } from "./log"
import type { DiagnosticsSettingsStore } from "./settings"

type Transport = ReturnType<
  ReturnType<typeof Sentry.makeElectronOfflineTransport>
>
type TransportOptions = Parameters<
  ReturnType<typeof Sentry.makeElectronOfflineTransport>
>[0]
type Envelope = Parameters<Transport["send"]>[0]
type EnvelopeItem = Envelope[1][number]

/** Errors kept back for the user to send, newest last. */
const HELD_ERRORS = 20

/**
 * Sentry integrations the app replaces: its own handlers log, report and offer each uncaught
 * error of the main process, and its preload includes Sentry's.
 */
const REPLACED_INTEGRATIONS = new Set([
  "OnUncaughtException",
  "OnUnhandledRejection",
  "PreloadInjection",
])

const itemTypes = (envelope: Envelope) =>
  (envelope[1] as readonly EnvelopeItem[]).map(([header]) => header.type)

/** The id of the error an envelope carries, if it carries one. */
function errorEventId(envelope: Envelope): string | null {
  const id = envelope[0].event_id
  return typeof id === "string" && itemTypes(envelope).includes("event")
    ? id
    : null
}

/** A breadcrumb holds a log record's first line: its message, and an error's name and message. */
const BREADCRUMB_LENGTH = 500

/** The shape Sentry's event ids have, for errors logged by builds that do not report. */
const localEventId = () => randomUUID().replaceAll("-", "")

/**
 * Error reports to the developers, through Sentry, when the build has a DSN. Reports leave the
 * Mac only when the user lets them go automatically (Settings) or sends one from the error
 * dialog: until then an error is kept back here, and sessions and everything else are dropped.
 * Feedback always goes, as only the user sends it. The renderer's reports reach Sentry through
 * this process too, over Sentry's IPC (IPCMode.Classic: no privileged sentry-ipc:// scheme,
 * whose fetches would bypass the page's content security policy).
 *
 * Unexpected errors of the main process and the machine process are logged, reported and offered
 * to the window, which shows them; without a window, an uncaught exception shows in a message box.
 */
export class ErrorReports {
  /** Whether this build reports errors: it was built with a Sentry DSN. */
  readonly reporting: boolean
  private transport: Transport | null = null
  private readonly held = new Map<string, Envelope>()
  /** Errors sent before they arrived here, still on their way from the renderer. */
  private readonly approved = new Set<string>()
  private readonly listeners = new Set<(error: MainError) => void>()
  /** Errors that happened while no window listened; the next one to listen shows them. */
  private missed: MainError[] = []

  constructor(
    private readonly settings: DiagnosticsSettingsStore,
    dsn: string | undefined
  ) {
    this.reporting = Boolean(dsn)
    if (dsn) {
      Sentry.init({
        dsn,
        release: `openspindle@${app.getVersion()}`,
        environment: app.isPackaged ? "production" : "development",
        ipcMode: Sentry.IPCMode.Classic,
        sendDefaultPii: false,
        sendClientReports: false,
        integrations: (defaults) =>
          defaults.filter(
            (integration) => !REPLACED_INTEGRATIONS.has(integration.name)
          ),
        transport: (options: TransportOptions) =>
          this.gate(Sentry.makeElectronOfflineTransport()(options)),
      })
      // Reports carry the log's last lines, the renderer's too, as breadcrumbs. Not its debug
      // lines: at Debug the renderer's include Sentry's own breadcrumbs, which reports have.
      log.subscribe(({ level, source, text, time }) => {
        if (level === "debug") return
        Sentry.addBreadcrumb({
          category: "log",
          level: level === "warn" ? "warning" : level,
          message: text.split("\n", 1)[0].slice(0, BREADCRUMB_LENGTH),
          data: { process: source },
          timestamp: time / 1000,
        })
      })
    }
    process.on("uncaughtException", (error) =>
      this.processError("main", error, "onuncaughtexception")
    )
    process.on("unhandledRejection", (reason) =>
      this.processError("main", reason, "onunhandledrejection")
    )
  }

  /** Errors of the main process; those that happened before anything listened come first. */
  subscribe(listener: (error: MainError) => void): () => void {
    this.listeners.add(listener)
    const missed = this.missed
    this.missed = []
    for (const error of missed) listener(error)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Sends an error the user reports. It went already when reports are automatic. */
  async send(eventId: string): Promise<void> {
    if (!this.transport)
      throw new Error("This copy of OpenSpindle does not send error reports.")
    const envelope = this.held.get(eventId)
    if (!envelope) {
      this.approve(eventId)
      return
    }
    this.held.delete(eventId)
    log.info(`Sending error ${eventId}, as the user asked`)
    // Offline, the transport keeps it and tries again later.
    await this.transport.send(envelope)
  }

  private gate(transport: Transport): Transport {
    this.transport = transport
    return {
      send: (envelope) => this.route(transport, envelope),
      flush: (timeout) => transport.flush(timeout),
    }
  }

  private route(transport: Transport, envelope: Envelope) {
    if (
      this.settings.get().reportAutomatically ||
      itemTypes(envelope).includes("feedback")
    )
      return transport.send(envelope)
    const eventId = errorEventId(envelope)
    if (eventId && this.approved.delete(eventId))
      return transport.send(envelope)
    if (eventId) this.hold(eventId, envelope)
    return Promise.resolve({})
  }

  private hold(eventId: string, envelope: Envelope) {
    this.held.set(eventId, envelope)
    for (const oldest of this.held.keys()) {
      if (this.held.size <= HELD_ERRORS) break
      this.held.delete(oldest)
    }
  }

  private approve(eventId: string) {
    this.approved.add(eventId)
    for (const oldest of this.approved) {
      if (this.approved.size <= HELD_ERRORS) break
      this.approved.delete(oldest)
    }
  }

  /**
   * An unexpected error of the main process or of the machine process, which sends its own here,
   * and its stopping: logged, reported, and offered to the window.
   */
  processError(
    source: "main" | "machine",
    error: unknown,
    mechanism: "onuncaughtexception" | "onunhandledrejection" | "onexit"
  ) {
    const eventId = this.reporting
      ? Sentry.captureException(error, {
          mechanism: { type: `auto.node.${mechanism}`, handled: false },
          captureContext: { tags: { process: source } },
        })
      : localEventId()
    log.error(`Error ${eventId} in the ${source} process`, error)
    log.flushSync()
    const report: MainError = { eventId, error: errorSummary(error) }
    if (this.listeners.size) {
      for (const listener of this.listeners) listener(report)
      return
    }
    // In place of Electron's own message box for an uncaught exception, with the error's id.
    if (mechanism === "onuncaughtexception")
      showErrorMessage(
        "OpenSpindle ran into an error",
        `${report.error.name}: ${report.error.message}\n\nError ID: ${eventId}`
      )
    else this.missed = [...this.missed.slice(-4), report]
  }
}
