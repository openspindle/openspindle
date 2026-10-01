import { errorText } from "../../src/platform/contract/diagnostics"
import type { LogLevel } from "../../src/platform/contract/diagnostics"
import type { FromMachine } from "./protocol.ts"

function record(level: LogLevel, message: string, detail?: unknown) {
  const sent: FromMachine = {
    kind: "log",
    level,
    message,
    detail: detail === undefined ? undefined : errorText(detail),
  }
  process.parentPort.postMessage(sent)
}

/**
 * The machine process's log: its records go to the main process, which writes the app's one log
 * and leaves out those below the chosen level.
 */
export const log = {
  error: (message: string, detail?: unknown) =>
    record("error", message, detail),
  warn: (message: string, detail?: unknown) => record("warn", message, detail),
  info: (message: string, detail?: unknown) => record("info", message, detail),
  debug: (message: string, detail?: unknown) =>
    record("debug", message, detail),
}
