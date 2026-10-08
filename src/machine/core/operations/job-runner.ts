import { DEVICE_ASSISTS, partText, programParts } from "../../contract/index.ts"
import type {
  JobState,
  PlateAssists,
  PreparedProgram,
  RunRequest,
  Telemetry,
} from "../../contract/index.ts"
import { FAILURE_LINES, excerpt } from "../../firmware/adapter.ts"
import type {
  AssistStep,
  FirmwareAdapter,
  OutboundFrame,
  SettingStep,
  TransferProtocol,
} from "../../firmware/adapter.ts"
import { MachineError, abortError } from "../errors.ts"
import { PartedCompletion } from "../parted-completion.ts"
import { freshStatus, requireAdmission } from "./context.ts"
import type { OperationContext } from "./context.ts"

const STEP_MS = 10_000
/** Upload, readback and both preflights together, for each file sent. */
const PREPARATION_MS = 80_000
/**
 * The slowest a program may go up and be read back, bytes per second: under half the slowest
 * seen over a Z1's network. A transfer that stalls fails sooner, at `STEP_MS` without progress.
 */
const MIN_TRANSFER_RATE = 8 * 1024

/** How long preparing a file of `bytes` may take: `PREPARATION_MS`, and its upload and readback at `MIN_TRANSFER_RATE`. */
const preparationMs = (bytes: number) =>
  PREPARATION_MS + ((2 * bytes) / MIN_TRANSFER_RATE) * 1000
const START_MS = 8_000

export type JobRunnerHooks = {
  readonly md5: (bytes: Uint8Array) => string
  readonly update: (patch: Partial<JobState>) => void
  /** From here on the controller feeds statuses and unclaimed lines to the tracker. */
  readonly attach: (tracker: PartedCompletion) => void
  /** The in-flight transfer, so Stop can cancel it synchronously before halting. */
  readonly transferring: (protocol: TransferProtocol | null) => void
  /** The bed cleaning the machine was set to before the run, which its last part restores. */
  readonly bedCleanBefore: (enabled: boolean | null) => void
}

const transferPhase = (transfer: TransferProtocol): JobState["phase"] =>
  transfer.stage === "upload" ? "uploading" : "verifying"

/** Where part `index` of a run is stored: the run's own file when it is sent whole. */
export const partPath = (
  adapter: FirmwareAdapter,
  id: string,
  index: number,
  count: number
) => adapter.job.path(count === 1 ? id : `${id}-${index + 1}`)

/**
 * The assists a part plays with. The machine cleans the bed after every file it plays, so a
 * part before the last never does; the last cleans as the plate asks, and "device" gives it
 * what the machine was set to before the run.
 */
export function partAssists(
  assists: PlateAssists | null,
  bedCleanBefore: boolean | null,
  index: number,
  count: number
): PlateAssists | null {
  if (count === 1) return assists
  const plate = assists ?? DEVICE_ASSISTS
  if (index < count - 1) return { ...plate, bedClean: "off" }
  if (plate.bedClean !== "device" || bedCleanBefore === null) return plate
  return { ...plate, bedClean: bedCleanBefore ? "on" : "off" }
}

function assistSteps(
  context: OperationContext,
  assists: PlateAssists | null,
  telemetry: Telemetry
): AssistStep[] {
  try {
    return context.adapter.job.assistPlan(assists, telemetry)
  } catch (error) {
    throw new MachineError(
      "refused",
      error instanceof Error ? error.message : "Invalid plate assists."
    )
  }
}

/** Aborts with the context, or when the preparation outlasts `milliseconds`. */
function withDeadline(context: OperationContext, milliseconds: number) {
  const { clock } = context
  const preparation = new AbortController()
  const onAbort = () => preparation.abort(context.signal.reason)
  context.signal.addEventListener("abort", onAbort, { once: true })
  const deadline = clock.setTimeout(
    () =>
      preparation.abort(
        new MachineError(
          "timeout",
          "Run preparation timed out. Nothing was retried; check the device before reconnecting."
        )
      ),
    milliseconds
  )
  return {
    scoped: { ...context, signal: preparation.signal },
    release: () => {
      clock.clearTimeout(deadline)
      context.signal.removeEventListener("abort", onAbort)
    },
  }
}

/**
 * One immutable upload → readback → play transaction. Data and motion are never
 * retried; any doubt before play leaves the program unstarted. A program sent as parts has
 * every part uploaded and read back before the first plays.
 */
export async function prepareAndStart(
  context: OperationContext,
  request: RunRequest,
  program: PreparedProgram,
  hooks: JobRunnerHooks
): Promise<void> {
  const { session, adapter, clock } = context
  const job = adapter.job
  const parts = programParts(program)
  const { scoped, release } = withDeadline(
    context,
    parts.reduce((total, part) => total + preparationMs(part.bytes), 0)
  )
  try {
    let telemetry = await preflight(scoped)
    hooks.bedCleanBefore(job.bedClean(telemetry))
    const assists = partAssists(
      request.assists,
      job.bedClean(telemetry),
      0,
      parts.length
    )
    for (const step of assistSteps(scoped, assists, telemetry))
      await applySetting(
        scoped,
        step,
        `the ${step.key} assist`,
        "The device did not apply the requested assist mode. Some settings may remain changed; the program was not started."
      )
    const lines = program.text.split("\n")
    for (const [index, part] of parts.entries()) {
      const bytes = new TextEncoder().encode(partText(lines, part))
      const path = partPath(adapter, request.id, index, parts.length)
      hooks.update({ part: index, path })
      await transferProgram(
        scoped,
        job.createTransfer(bytes, hooks.md5(bytes), path),
        hooks
      )
    }
    telemetry = await preflight(scoped)
    if (job.assistPlan(assists, telemetry).length)
      throw new MachineError(
        "refused",
        "Device assist settings changed during transfer. Review them before Run."
      )
    const identity = session.identity
    if (!identity)
      throw new MachineError("connection-lost", "The device is disconnected.")
    // Kept, the tool the machine holds stays: a first change to it changes nothing.
    const reset = request.keepTool
      ? null
      : job.toolReset(program, identity, telemetry)
    if (reset)
      await applySetting(
        scoped,
        reset,
        "forgetting the tool",
        "The device did not forget its tool, so the first tool change might not stop; the program was not started."
      )
    const tracker = new PartedCompletion(program, (part, bedClean) =>
      job.createCompletion(part, bedClean, () => clock.now())
    )
    await play(
      scoped,
      tracker,
      0,
      partPath(adapter, request.id, 0, parts.length),
      job.bedClean(telemetry),
      hooks
    )
  } finally {
    release()
  }
}

/**
 * Plays part `index`, which the tracker gave to this start (`claimNext`) once the one before it
 * completed. Every part was sent before the first played, so this is the same preflight as
 * before any play, the last part's bed cleaning as the plate asks, and one play.
 */
export async function playNextPart(
  context: OperationContext,
  request: RunRequest,
  bedCleanBefore: boolean | null,
  tracker: PartedCompletion,
  index: number,
  hooks: JobRunnerHooks
): Promise<void> {
  const { adapter } = context
  const count = tracker.parts.length
  const { scoped, release } = withDeadline(context, PREPARATION_MS)
  try {
    let telemetry = await preflight(scoped)
    const assists = partAssists(request.assists, bedCleanBefore, index, count)
    const steps = assistSteps(scoped, assists, telemetry)
    for (const step of steps)
      await applySetting(
        scoped,
        step,
        `the ${step.key} assist`,
        `The device did not apply the requested assist mode; part ${index + 1} of ${count} was not started.`
      )
    if (steps.length) telemetry = await preflight(scoped)
    await play(
      scoped,
      tracker,
      index,
      partPath(adapter, request.id, index, count),
      adapter.job.bedClean(telemetry),
      hooks
    )
  } finally {
    release()
  }
}

/** Homed axes (G28.6 and its acknowledgement) plus a fresh status that passes the run rules. */
async function preflight(context: OperationContext): Promise<Telemetry> {
  const { session, adapter } = context
  let homed: boolean | null = null
  const report = session.request<boolean>(
    [adapter.job.homedQuery],
    (event) => {
      if (event.kind !== "line") return "ignored"
      const parsed = adapter.job.homed(event.line.text)
      if (parsed) {
        homed = parsed.homed
        return parsed.acknowledged ? { done: parsed.homed } : "consumed"
      }
      if (event.line.kind === "ack" && homed !== null) return { done: homed }
      if (FAILURE_LINES.has(event.line.kind))
        return {
          fail: new MachineError(
            "rejected",
            `The device rejected the homed-axes check: ${excerpt(event.line.text)}`
          ),
        }
      return "ignored"
    },
    {
      timeoutMs: STEP_MS,
      timeoutMessage:
        "Timed out checking the device state and homed axes. No play command was sent.",
      signal: context.signal,
    }
  )
  if (!(await report))
    throw new MachineError("refused", "Home all reported axes before Run.")
  const telemetry = await freshStatus(
    context,
    "Timed out waiting for fresh device status. No play command was sent."
  )
  requireAdmission(context, { key: "run" }, telemetry)
  return telemetry
}

/** Sends a setting, then awaits its acknowledgement and a newer status showing it applied. */
async function applySetting(
  context: OperationContext,
  step: SettingStep,
  label: string,
  failure: string
) {
  const { session } = context
  const after = session.store.sequence
  await sendAcknowledged(context, step.frame, label)
  session.requestStatus(true)
  await session.store.waitFor(step.applied, {
    after,
    timeoutMs: STEP_MS,
    timeoutMessage: failure,
    signal: context.signal,
  })
}

function sendAcknowledged(
  context: OperationContext,
  frame: OutboundFrame,
  label: string
) {
  return context.session.request<void>(
    [frame],
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
      timeoutMs: STEP_MS,
      timeoutMessage: `The device did not acknowledge ${label}. The program was not started.`,
      signal: context.signal,
    }
  )
}

/** Upload then full readback. Status polling pauses: the link belongs to the transfer. */
async function transferProgram(
  context: OperationContext,
  protocol: TransferProtocol,
  hooks: JobRunnerHooks
) {
  const { session } = context
  const progress = () =>
    hooks.update({
      phase: transferPhase(protocol),
      transfer: {
        uploadedBytes: protocol.uploadedBytes,
        verifiedBytes: protocol.verifiedBytes,
        totalBytes: protocol.totalBytes,
      },
    })
  progress()
  hooks.transferring(protocol)
  const release = session.suspendPolling()
  try {
    await session.request<void>(
      protocol.start(),
      (event) => {
        if (event.kind === "line")
          return FAILURE_LINES.has(event.line.kind)
            ? {
                fail: new MachineError(
                  "rejected",
                  `The device rejected the file transfer: ${excerpt(event.line.text)}. The program was not started.`
                ),
              }
            : "ignored"
        if (event.kind !== "transfer") return "ignored"
        let frames
        try {
          frames = protocol.receive(event.frame)
        } catch (error) {
          return {
            fail: new MachineError(
              "rejected",
              `${error instanceof Error ? error.message : "Unexpected file transfer response."} The program was not started.`
            ),
          }
        }
        for (const frame of frames) session.send(frame)
        progress()
        // A part sent next must not meet this transfer's last acknowledgement.
        return protocol.finished ? { done: undefined } : "consumed"
      },
      {
        timeoutMs: STEP_MS,
        timeoutMessage: "File transfer timed out. The program was not started.",
        signal: context.signal,
        rearm: true,
      }
    )
  } catch (error) {
    if (!session.closed)
      for (const frame of protocol.cancel()) session.send(frame)
    throw error
  } finally {
    hooks.transferring(null)
    release()
  }
}

/** Sends exactly one play; the part starts only when the machine reports player progress. */
async function play(
  context: OperationContext,
  tracker: PartedCompletion,
  index: number,
  path: string,
  bedClean: boolean | null,
  hooks: JobRunnerHooks
) {
  const { session, adapter } = context
  tracker.begin(index, bedClean)
  hooks.update({ phase: "starting", part: index, path, bedClean })
  hooks.attach(tracker)
  const starting = new AbortController()
  const onAbort = () => starting.abort(context.signal.reason)
  context.signal.addEventListener("abort", onAbort, { once: true })
  const unconfirmed =
    "The device has not confirmed the program started. Watch the machine; Stop remains available. Run was not retried."
  const refusal = session.expect<never>(
    (event) =>
      event.kind === "line" && FAILURE_LINES.has(event.line.kind)
        ? {
            fail: new MachineError(
              "rejected",
              `The device did not start the program: ${excerpt(event.line.text)}`
            ),
          }
        : "ignored",
    {
      timeoutMs: START_MS,
      timeoutMessage: unconfirmed,
      signal: starting.signal,
    }
  )
  const started = session.store.waitFor(
    () => tracker.update.phase !== "starting",
    {
      timeoutMs: START_MS,
      timeoutMessage: unconfirmed,
      signal: starting.signal,
    }
  )
  refusal.catch(() => {})
  started.catch(() => {})
  try {
    session.send(adapter.job.play(path))
    session.requestStatus(true)
    await Promise.race([started, refusal])
  } catch (error) {
    // The tracker keeps following a start that may still happen; Stop stays available.
    if (error instanceof MachineError && error.code === "timeout")
      throw new MachineError("unverified", unconfirmed)
    throw error
  } finally {
    context.signal.removeEventListener("abort", onAbort)
    if (!starting.signal.aborted)
      starting.abort(new MachineError("cancelled", "The start check ended."))
  }
  if (context.signal.aborted) throw abortError(context.signal)
}
