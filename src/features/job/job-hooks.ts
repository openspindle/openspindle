import { useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { limitsFor, planFor } from "@/app/job/plan-store"
import {
  programPositionOf,
  simulatedBedOf,
} from "@/app/workspace/machine-program"
import { usePlateDiagnostics } from "@/app/workspace/use-plate-diagnostics"
import {
  plateIndex,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { compilePlate } from "@/domain/compile/compile"
import type { CompiledPlate } from "@/domain/compile/compile"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { plateLabel } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import { rulesOf } from "@/domain/rules/rules"
import { runSubjects } from "@/domain/rules/stages"
import { usePlateDesignRuleCheck } from "@/features/design-rules/design-rule-check"
import {
  isFresh,
  isSimulator,
  isHeightCompensationOff,
  machineId,
  runRules,
  toDisplayName,
} from "@/machine/contract"
import type {
  Availability,
  MachineSnapshot,
  Telemetry,
} from "@/machine/contract"
import type { Tool } from "@/domain/tools/tool"
import {
  machineKeys,
  useCachedConfiguration,
  useDismissJob,
  useMachineCommand,
  useMachineSnapshot,
  useRunProgram,
  useSimulateBed,
  useStopMachine,
  useMachineHost,
} from "@/platform/machine"
import { createJobSession, jobSessionStore } from "./job-session"
import type { ProgramCheck } from "./program-check"
import { evaluateRunChecklist } from "./run-checklist"
import type { RunChecklist } from "./run-checklist"
import { openDialog } from "@/features/shell/dialogs"
import { zJobIssue, zJobSignature } from "./z-probe-job"
import type { ZProbeCompletion } from "./z-probe-job"

/** The Run checklist of a plate, against the connected machine. */
export function useRunChecklist(
  plate: Plate | null,
  compiled: CompiledPlate | null,
  check: ProgramCheck
): RunChecklist {
  const snapshot = useMachineSnapshot()
  const diagnostics = usePlateDiagnostics(plate)
  const designRules = usePlateDesignRuleCheck(plate)
  const device = snapshot.connection.device
  const connectedDeviceId = device ? machineId(device) : null
  const anchors = snapshot.anchors.value
  const compensation = snapshot.telemetry?.compensation ?? null
  const originX = snapshot.telemetry?.workOrigin?.x ?? null
  const originY = snapshot.telemetry?.workOrigin?.y ?? null
  const runFailures = useMemo(
    () =>
      runRules(
        rulesOf("run"),
        runSubjects(plate, {
          connectedDeviceId,
          anchors,
          compensation,
          workOrigin:
            originX === null || originY === null ? null : [originX, originY],
        })
      ),
    [plate, connectedDeviceId, anchors, compensation, originX, originY]
  )
  return evaluateRunChecklist({
    plate,
    compiled,
    diagnostics,
    runFailures,
    designRules,
    snapshot,
    check,
  })
}

/** A machine action as a control needs it. */
export type MachineAction = {
  /** Why the action is unavailable, from machine availability; null when it may run. */
  readonly reason: string | null
  /** The request is in flight. */
  readonly pending: boolean
  readonly run: () => void
}

/** Availability is the only source of a disabled reason; a deferred action is allowed. */
export const availabilityReason = (entry: Availability): string | null =>
  entry.allowed ? null : (entry.reason ?? "Unavailable.")

const report = (error: Error) => toast.error(error.message)

export type JobActions = {
  readonly pause: MachineAction
  readonly resume: MachineAction
  readonly confirmToolChange: MachineAction
  readonly stop: MachineAction
  /** Clears a finished job from the machine and ends this window's Run session. */
  readonly dismiss: MachineAction
}

/** Every machine action of the Job tab, enabled by availability; failures become toasts. */
export function useJobActions(): JobActions {
  const { availability } = useMachineSnapshot()
  const command = useMachineCommand()
  const stop = useStopMachine()
  const dismiss = useDismissJob()
  const execute = (
    type: "pause" | "resume" | "confirmToolChange"
  ): MachineAction => ({
    reason: availabilityReason(availability[type]),
    pending: command.isPending,
    run: () => command.mutate({ type }, { onError: report }),
  })
  return {
    pause: execute("pause"),
    resume: execute("resume"),
    confirmToolChange: execute("confirmToolChange"),
    stop: {
      reason: availabilityReason(availability.stop),
      pending: stop.isPending,
      run: () => stop.mutate(undefined, { onError: report }),
    },
    dismiss: {
      reason: null,
      pending: dismiss.isPending,
      run: () =>
        dismiss.mutate(undefined, {
          onSuccess: () => {
            jobSessionStore.actions.clear()
          },
          onError: report,
        }),
    },
  }
}

/**
 * Run: snapshots the plate into a new session, with the plan of its machine's moves timed by the
 * limits of the machine's configuration as last read (its defaults when it was not), then sends
 * exactly that program.
 */
/**
 * Where the tool's tip is in a plate's program coordinates, as the machine's status reports it:
 * where the machine is less the tool's offset. Null without a fresh machine position, or where
 * the preview does not place the plate's machine.
 */
function tipInProgram(plate: Plate, telemetry: Telemetry | null) {
  const machine = telemetry?.machine
  if (!machine) return null
  return programPositionOf(plate, [
    machine.x,
    machine.y,
    machine.z - (telemetry.toolOffset ?? 0),
  ])
}

export function useRunJob() {
  const host = useMachineHost()
  const workspace = useWorkspaceStore()
  const client = useQueryClient()
  const { connection } = useMachineSnapshot()
  const { device } = connection
  const configuration = useCachedConfiguration(connection.id)
  const run = useRunProgram()
  const simulateBed = useSimulateBed()
  const startCut = (
    plate: Plate,
    compiled: CompiledPlate,
    library: readonly Tool[],
    keptTool: number | null,
    completion?: ZProbeCompletion
  ) => {
    const live = client.getQueryData<MachineSnapshot>(machineKeys.snapshot)
    if (
      !live ||
      live.connection.id !== connection.id ||
      !live.availability.run.allowed
    ) {
      toast.error("The machine is no longer ready to run this program.")
      return
    }
    const fresh = isFresh(live.telemetry, Date.now()) ? live.telemetry : null
    const label = plateLabel(plate, plateIndex(workspace.state, plate.id))
    // Planned from where the machine is, as it starts the program there with what it holds.
    const plan = planFor(
      plate,
      compiled.program,
      limitsFor(kitForPlate(plate), configuration),
      tipInProgram(plate, fresh),
      keptTool
    )
    const runPlate = () => {
      const session = createJobSession(
        plate,
        label,
        compiled,
        library,
        plan,
        device
      )
      jobSessionStore.actions.begin(session)
      run.mutate(
        {
          id: session.runId,
          name: toDisplayName(label, "Plate"),
          expectedConnectionId: connection.id ?? undefined,
          ...(completion
            ? {
                zReference: {
                  tool: completion.tool,
                  toolOffset: completion.offset,
                  originZ: completion.originZ,
                },
              }
            : {}),
          source: compiled.program.source,
          assists: plate.setup.assists,
          ...(keptTool !== null && { keepTool: true }),
        },
        { onError: report }
      )
    }
    // The simulator first takes what the plate positions on its bed, to probe against it.
    const bed = device && isSimulator(device) ? simulatedBedOf(plate) : null
    if (!bed) {
      runPlate()
      return
    }
    simulateBed.mutate(bed, { onSuccess: runPlate, onError: report })
  }
  const start = async (
    plate: Plate,
    compiled: CompiledPlate,
    library: readonly Tool[],
    keptTool: number | null = null,
    completion?: ZProbeCompletion
  ) => {
    try {
      if (plate.setup.probeBeforeRun) {
        const issue = zJobIssue(
          compiled,
          kitForPlate(plate).zProbing?.tools ?? []
        )
        if (issue) throw new Error(issue)
        const signature = zJobSignature(plate, compiled, library)
        if (!completion) {
          if (!connection.id)
            throw new Error("Connect the job's machine first.")
          openDialog({
            kind: "z-probe",
            job: { plateId: plate.id, signature, connectionId: connection.id },
          })
          return
        }
        const fresh = await host.snapshot()
        const current = workspace.state.plates.find(
          (entry) => entry.id === plate.id
        )
        const t = fresh.telemetry
        if (
          !current ||
          zJobSignature(
            current,
            compilePlate(current, workspace.state.tools),
            workspace.state.tools
          ) !== signature ||
          signature !== completion.signature ||
          fresh.connection.id !== completion.connectionId ||
          connection.id !== completion.connectionId ||
          Date.now() - completion.at > 120000 ||
          fresh.job ||
          !fresh.availability.run.allowed ||
          fresh.availability.run.deferred ||
          !isFresh(t, Date.now()) ||
          t.state !== "Idle" ||
          t.job !== null ||
          t.tool !== completion.tool ||
          t.toolOffset !== completion.offset ||
          !t.workOrigin ||
          Math.abs(t.workOrigin.z - completion.originZ) > 0.001 ||
          t.spindleRpm !== 0 ||
          t.spindleOn === true ||
          !isHeightCompensationOff(t)
        )
          throw new Error(
            "The cutting job, connection or measured Z reference changed. Press Run and probe Z again; nothing was started."
          )
      }
      startCut(
        plate,
        compiled,
        library,
        completion ? null : keptTool,
        completion
      )
    } catch (error) {
      report(error instanceof Error ? error : new Error(String(error)))
    }
  }
  return { start, pending: run.isPending || simulateBed.isPending }
}
