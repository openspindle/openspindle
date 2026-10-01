import type { LogLevel } from "../../src/platform/contract/diagnostics"
import type { Principal } from "../../src/machine/core/gateway.ts"

/** Main process → machine process, over its parent port. */
export type ToMachine =
  | {
      readonly kind: "start"
      /** The app's data folder, which keeps the last used device. */
      readonly userData: string
      /** Whether to connect to the last used device: at launch, not after a restart. */
      readonly reconnect: boolean
      /** Why there is no connection: the machine process before this one stopped. */
      readonly error: string | null
    }
  /** Carries one port, served to the principal. */
  | { readonly kind: "connect"; readonly principal: Principal["kind"] }
  /** Closes the connection, which leaves a running program running, and ends the process. */
  | { readonly kind: "quit" }

/** An error as it crosses to the main process, which reports it. */
export type ErrorRecord = {
  readonly name: string
  readonly message: string
  readonly stack: string | undefined
}

/** Machine process → main process, over its parent port. */
export type FromMachine =
  | {
      readonly kind: "log"
      readonly level: LogLevel
      readonly message: string
      /** The detail as the log writes it. */
      readonly detail: string | undefined
    }
  | {
      readonly kind: "error"
      readonly mechanism: "onuncaughtexception" | "onunhandledrejection"
      readonly error: ErrorRecord
    }
