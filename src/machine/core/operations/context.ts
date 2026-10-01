import type { Telemetry } from "../../contract/index.ts"
import { FAILURE_LINES, excerpt } from "../../firmware/adapter.ts"
import type { FirmwareAdapter } from "../../firmware/adapter.ts"
import type { Admission, AdmissionRequest } from "../admission.ts"
import { MachineError, abortError } from "../errors.ts"
import type { Clock } from "../ports.ts"
import type { MachineSession } from "../session.ts"

export const PREFLIGHT_MS = 3000
const AUTOMATIC_READY_MS = 30000
const IDENTITY_PROBE_MS = 1000

/** What an operation may use; it owns the machine until it settles. */
export type OperationContext = {
  readonly session: MachineSession
  readonly adapter: FirmwareAdapter
  readonly clock: Clock
  readonly signal: AbortSignal
  /** A program stream exists (acknowledgements are not ours). */
  readonly streaming: () => boolean
  /** Admission against fresh telemetry, ignoring the operation's own activity. */
  readonly admit: (request: AdmissionRequest, telemetry: Telemetry) => Admission
}

/** A status newer than now; nothing is sent to the machine before it arrives. */
export function freshStatus(
  context: OperationContext,
  timeoutMessage: string
): Promise<Telemetry> {
  const after = context.session.store.sequence
  context.session.requestStatus(true)
  return context.session.store.waitFor(() => true, {
    after,
    timeoutMs: PREFLIGHT_MS,
    timeoutMessage,
    signal: context.signal,
  })
}

/** A status following a newly received diagnostic reply, for commands that depend on switches. */
export function freshDiagnosticStatus(
  context: OperationContext,
  timeoutMessage: string
): Promise<Telemetry> {
  const { session } = context
  const after = session.store.sequence
  const diagnosticsAfter = session.diagnostics?.sequence ?? 0
  session.requestStatus(true)
  return session.store.waitFor(
    () => (session.diagnostics?.sequence ?? 0) > diagnosticsAfter,
    {
      after,
      timeoutMs: PREFLIGHT_MS,
      timeoutMessage,
      signal: context.signal,
    }
  )
}

/**
 * The bridge may report the previous Idle state while the motion controller reboots.
 * Require the model reply itself to report Idle, then a newer ordinary Idle status,
 * before an automatic command takes ownership of acknowledgements after boot homing.
 */
export async function waitForAutomaticCommandReady(
  context: OperationContext,
  label: string
): Promise<void> {
  const { session, adapter, clock, signal } = context
  if (session.identityReplyState === "Idle") return
  const deadline = clock.now() + AUTOMATIC_READY_MS
  const timeoutMessage = `The controller did not become ready for ${label}. No command was sent.`
  while (clock.now() < deadline) {
    if (signal.aborted) throw abortError(signal)
    const after = session.store.sequence
    // Only this read-only query is repeated. The automatic command is never retried.
    session.send(adapter.queries.identity)
    session.requestStatus(true)
    try {
      await session.store.waitFor(
        (telemetry) =>
          session.identityReplyState === "Idle" &&
          telemetry.state === "Idle" &&
          telemetry.job === null,
        {
          after,
          timeoutMs: Math.min(IDENTITY_PROBE_MS, remaining(clock, deadline)),
          timeoutMessage,
          signal,
        }
      )
      return
    } catch (error) {
      if (!(error instanceof MachineError) || error.code !== "timeout")
        throw error
    }
  }
  throw new MachineError("timeout", timeoutMessage)
}

export function requireAdmission(
  context: OperationContext,
  request: AdmissionRequest,
  telemetry: Telemetry
) {
  const admission = context.admit(request, telemetry)
  if (admission.verdict === "refuse")
    throw new MachineError("refused", admission.reason)
  if (admission.verdict === "defer")
    throw new MachineError("busy", admission.reason)
}

/**
 * The acknowledgement of the command about to be sent. Register before sending;
 * a failure report instead of the acknowledgement rejects it.
 */
export function expectAcknowledgement(
  context: OperationContext,
  label: string,
  timeoutMs: number
): Promise<void> {
  return context.session.expect<void>(
    (event) => {
      if (event.kind !== "line") return "ignored"
      if (event.line.kind === "ack") return { done: undefined }
      if (FAILURE_LINES.has(event.line.kind))
        return {
          fail: new MachineError(
            "rejected",
            `The device rejected ${label}: ${excerpt(event.line.text)}`
          ),
        }
      return "ignored"
    },
    {
      timeoutMs,
      timeoutMessage: `The device did not acknowledge ${label}.`,
      signal: context.signal,
    }
  )
}

export const remaining = (clock: Clock, deadline: number) =>
  Math.max(1, deadline - clock.now())
