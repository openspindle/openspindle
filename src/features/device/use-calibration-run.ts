import { useEffect, useMemo, useRef } from "react"
import { createAtom, useSelector } from "@tanstack/react-store"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { compilePlate } from "@/domain/compile/compile"
import type { Plate } from "@/domain/plate/plate"
import { simulatedBedOf } from "@/app/workspace/machine-program"
import {
  isFresh,
  isSimulator,
  isTerminalJobPhase,
  machineId,
  toDisplayName,
} from "@/machine/contract"
import type { MachineSnapshot } from "@/machine/contract"
import { useMachineHost, useMachineSnapshot } from "@/platform/machine"
import { createJobSession, jobSessionStore } from "@/features/job/job-session"
import type { JobSession } from "@/features/job/job-session"
import { useRunChecklist } from "@/features/job/job-hooks"
import { useCompiledProgramCheck } from "@/features/job/program-check"
import { deriveJobView } from "@/features/job/job-view"
import type { PointIntent } from "@/features/prepare/point-intent"
import type { WorkspaceDialog } from "@/features/shell/dialogs"

export type CalibrationStage = "setter" | "contacts"
type CalibrationRun = {
  guide: "anchor" | "z" | "point"
  point?: PointIntent
  intentKey?: string
  session: JobSession
  stage: CalibrationStage
  connectionId: string
  pending: boolean
  sent: boolean
  cancelled: boolean
  error: string | null
}
// Survives closing the guide, but is neither a project plate nor a persisted job recipe.
const runAtom = createAtom<CalibrationRun | null>(null)
export const useCalibrationRunRecord = () => useSelector(runAtom)
export function calibrationRunDialog(record: CalibrationRun): WorkspaceDialog {
  if (record.guide === "point" && record.point)
    return { kind: "point-actions", intent: record.point }
  if (record.guide === "z") return { kind: "z-probe" }
  return { kind: "anchor-calibration" }
}
export function calibrationRunLabel(record: CalibrationRun) {
  if (record.guide === "point") return "Continue probe positioning"
  if (record.guide === "z") return "Continue Z probing"
  return "Continue Anchor 1 calibration"
}
const update = (runId: string, patch: Partial<CalibrationRun>) =>
  runAtom.set((current) =>
    current?.session.runId === runId ? { ...current, ...patch } : current
  )
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

function sameConnection(snapshot: MachineSnapshot, connectionId: string) {
  if (
    snapshot.connection.status !== "connected" ||
    snapshot.connection.id !== connectionId
  )
    throw new Error(
      "The device connection changed. No following calibration step was sent."
    )
}

/** Mounted once: a failed temporary run cannot strand a lock in a closed guide. */
export function useCalibrationRunRecovery() {
  const host = useMachineHost()
  const snapshot = useMachineSnapshot()
  const record = useCalibrationRunRecord()
  const attempted = useRef<string | null>(null)
  useEffect(() => {
    if (!record || record.pending || attempted.current === record.session.runId)
      return
    const failed = (fresh: MachineSnapshot) => {
      const job = fresh.job
      if (job?.id !== record.session.runId)
        return !!record.error || record.cancelled || record.sent
      if (!isTerminalJobPhase(job.phase)) return false
      if (job.phase === "completed" && !record.error && !record.cancelled)
        return false
      // A disconnected machine may still be running. Wait for reconnection and
      // confirmed stopped telemetry before forgetting that uncertain outcome.
      if (job.phase === "lost" || fresh.connection.id !== record.connectionId) {
        const t = fresh.telemetry
        return (
          fresh.connection.status === "connected" &&
          isFresh(t, Date.now()) &&
          t.state === "Idle" &&
          t.job === null &&
          t.spindleOn === false &&
          t.spindleRpm === 0
        )
      }
      return true
    }
    if (!failed(snapshot)) return
    attempted.current = record.session.runId
    void (async () => {
      const fresh = await host.snapshot()
      if (
        runAtom.get()?.session.runId !== record.session.runId ||
        !failed(fresh)
      ) {
        attempted.current = null
        return
      }
      const detail =
        fresh.job?.id === record.session.runId ? fresh.job.error : record.error
      // This only removes terminal bookkeeping. It sends no Stop, unlock, home
      // or motion commands, and the controller's machine lockout stays intact.
      await host.dismissJob(record.session.runId)
      if (jobSessionStore.state?.runId === record.session.runId)
        jobSessionStore.actions.clear()
      if (runAtom.get()?.session.runId === record.session.runId)
        runAtom.set(() => null)
      toast.error(detail ?? "Temporary run ended without a verified result.", {
        description:
          "Temporary run cleared. Check the machine before starting again; nothing was retried or unlocked.",
        duration: 12000,
      })
    })().catch((error: unknown) =>
      toast.error(`Could not clear the temporary run: ${message(error)}`)
    )
  }, [host, record, snapshot])
}

/** Explicit Run uses the existing checked job engine without adding a workspace plate. */
export function useCalibrationRun(
  candidate: Plate | null,
  selectedToolId: string | null,
  guide: "anchor" | "z" | "point" = "anchor",
  point?: PointIntent,
  intentKey?: string
) {
  const host = useMachineHost()
  const snapshot = useMachineSnapshot()
  const tools = useWorkspace((state) => state.tools)
  const currentRecord = useCalibrationRunRecord()
  const record = currentRecord?.guide === guide ? currentRecord : null
  const compiled = useMemo(
    () => (candidate ? compilePlate(candidate, tools) : null),
    [candidate, tools]
  )
  const check = useCompiledProgramCheck(compiled)
  const checklist = useRunChecklist(candidate, compiled, check)
  const job =
    record && snapshot.job?.id === record.session.runId ? snapshot.job : null
  const view = deriveJobView(record?.session ?? null, snapshot)
  const busy =
    !!record && (record.pending || (!!job && !isTerminalJobPhase(job.phase)))
  const connectionMatches =
    !!record &&
    snapshot.connection.status === "connected" &&
    snapshot.connection.id === record.connectionId
  const reportError = (error: Error) => toast.error(error.message)
  const run = useMutation({
    mutationFn: async (stage: CalibrationStage) => {
      if (
        !candidate ||
        !compiled ||
        !checklist.ready ||
        runAtom.get() ||
        snapshot.job
      )
        throw new Error(
          checklist.blocker ??
            "Dismiss the previous run before starting another stage."
        )
      const connectionId = snapshot.connection.id
      const device = snapshot.connection.device
      if (
        !connectionId ||
        !device ||
        machineId(device) !== candidate.setup.deviceId
      )
        throw new Error("Connect the calibration's device first.")
      const session = createJobSession(
        candidate,
        candidate.name,
        compiled,
        tools,
        null,
        device
      )
      runAtom.set(() => ({
        guide,
        point,
        intentKey,
        session,
        stage,
        connectionId,
        pending: true,
        sent: false,
        cancelled: false,
        error: null,
      }))
      const stillWanted = () => {
        const current = runAtom.get()
        if (current?.session.runId !== session.runId || current.cancelled)
          throw new Error(
            "Calibration stopped before starting. No motion was retried."
          )
      }
      try {
        const fresh = await host.snapshot()
        stillWanted()
        sameConnection(fresh, connectionId)
        if (
          fresh.job ||
          !fresh.availability.run.allowed ||
          fresh.availability.run.deferred
        )
          throw new Error(
            fresh.availability.run.reason ??
              "The machine is not ready for a new stage."
          )
        // A checked probe start must not be disturbed by simulator geometry configuration.
        if (stage === "setter" && isSimulator(device)) {
          const bed = simulatedBedOf(candidate)
          if (bed) await host.simulateBed(bed)
        }
        const ready = await host.snapshot()
        stillWanted()
        sameConnection(ready, connectionId)
        if (ready.job)
          throw new Error("Another run started. This stage was not sent.")
        jobSessionStore.actions.begin(session)
        update(session.runId, { sent: true })
        await host.run({
          id: session.runId,
          name: toDisplayName(session.label, "Calibration"),
          expectedConnectionId: connectionId,
          source: compiled.program.source,
          // Setup stages must not inherit automatic bed cleaning or other machining assists.
          assists: candidate.setup.assists,
        })
      } catch (error) {
        update(session.runId, { error: message(error) })
        throw error
      } finally {
        update(session.runId, { pending: false })
      }
    },
    onError: reportError,
  })
  const stop = useMutation({
    mutationFn: async () => {
      const current = runAtom.get()
      if (!current) return
      update(current.session.runId, { cancelled: true })
      // Cancel the intent synchronously before any outstanding read/configuration resolves.
      if (!current.sent) return
      sameConnection(snapshot, current.connectionId)
      if (snapshot.job && snapshot.job.id !== current.session.runId)
        throw new Error(
          "This guide no longer owns the machine's run. Check Job before stopping it."
        )
      await host.stop()
    },
    onError: reportError,
  })
  const dismiss = useMutation({
    mutationFn: async () => {
      const current = runAtom.get()
      if (!current || current.pending)
        throw new Error("Wait for the run request to settle, or use Stop.")
      const fresh = await host.snapshot()
      if (fresh.job?.id === current.session.runId) {
        if (!isTerminalJobPhase(fresh.job.phase))
          throw new Error("Stop the active run before dismissing it.")
        // A lost run remains in the host after reconnect. Forgetting its terminal
        // record sends no motion, but never treat it as a completed measurement.
        if (
          fresh.connection.id !== current.connectionId &&
          (!isFresh(fresh.telemetry, Date.now()) ||
            fresh.telemetry.state !== "Idle" ||
            fresh.telemetry.job !== null ||
            fresh.telemetry.spindleOn !== false ||
            fresh.telemetry.spindleRpm !== 0)
        )
          throw new Error(
            "Check that the machine has stopped. Dismiss the lost run once it reports Idle with the spindle off."
          )
        await host.dismissJob(current.session.runId)
      }
      if (jobSessionStore.state?.runId === current.session.runId)
        jobSessionStore.actions.clear()
      if (runAtom.get()?.session.runId === current.session.runId)
        runAtom.set(() => null)
    },
    onError: reportError,
  })
  const continueSetter = useMutation({
    mutationFn: async () => {
      const current = runAtom.get()
      if (
        !current ||
        current.stage !== "setter" ||
        current.pending ||
        current.error ||
        current.cancelled
      )
        throw new Error("Complete a verified tool-setter run first.")
      const fresh = await host.snapshot()
      sameConnection(fresh, current.connectionId)
      const number = current.session.plate.tools[0]?.number
      const measuredTool = current.session.tools.at(0)
      if (
        !measuredTool ||
        selectedToolId !== measuredTool.id ||
        JSON.stringify(tools.find((tool) => tool.id === selectedToolId)) !==
          JSON.stringify(measuredTool)
      )
        throw new Error(
          "The selected probe entry changed. Dismiss this run and review the fitted probe before continuing."
        )
      const measured = fresh.job?.measurements.filter(
        (item) =>
          item.kind === "touch" &&
          item.target === "tool-sensor" &&
          item.tool === number
      )
      const status = fresh.telemetry
      if (
        fresh.job?.id !== current.session.runId ||
        fresh.job.phase !== "completed" ||
        !measured?.length ||
        !isFresh(status, Date.now()) ||
        status.state !== "Idle" ||
        status.job !== null ||
        status.tool !== number ||
        status.toolOffset === null ||
        !Number.isFinite(status.toolOffset) ||
        status.spindleRpm !== 0 ||
        status.spindleOn === true
      )
        throw new Error(
          "The completed run, tool-sensor contact and fresh measured tool offset could not all be verified."
        )
      const offset = status.toolOffset
      await dismiss.mutateAsync()
      return offset
    },
    onError: reportError,
  })
  let reason = checklist.blocker
  if (currentRecord || snapshot.job)
    reason = "Finish or dismiss the current run before starting another stage."
  return {
    record,
    job,
    view,
    busy,
    connectionMatches,
    checklist,
    reason,
    run,
    stop,
    dismiss,
    continueSetter,
  }
}
