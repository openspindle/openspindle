import { useMemo } from "react"
import { toast } from "sonner"
import { simulatedBedOf } from "@/app/workspace/machine-program"
import { usePlateDiagnostics } from "@/app/workspace/use-plate-diagnostics"
import {
  plateIndex,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import type { CompiledPlate } from "@/domain/compile/compile"
import { plateLabel } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import { rulesOf } from "@/domain/rules/rules"
import { runSubjects } from "@/domain/rules/stages"
import { usePlateDesignRuleCheck } from "@/features/design-rules/design-rule-check"
import {
  isSimulator,
  machineId,
  runRules,
  toDisplayName,
} from "@/machine/contract"
import type { Availability } from "@/machine/contract"
import type { Tool } from "@/domain/tools/tool"
import {
  useDismissJob,
  useMachineCommand,
  useMachineSnapshot,
  useRunProgram,
  useSimulateBed,
  useStopMachine,
} from "@/platform/machine"
import { createJobSession, jobSessionStore } from "./job-session"
import type { ProgramCheck } from "./program-check"
import { evaluateRunChecklist } from "./run-checklist"
import type { RunChecklist } from "./run-checklist"

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
  const runFailures = useMemo(
    () =>
      runRules(
        rulesOf("run"),
        runSubjects(plate, { connectedDeviceId, anchors })
      ),
    [plate, connectedDeviceId, anchors]
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
          onSuccess: () => jobSessionStore.actions.clear(),
          onError: report,
        }),
    },
  }
}

/** Run: snapshots the plate into a new session, then sends exactly that program. */
export function useRunJob() {
  const workspace = useWorkspaceStore()
  const { device } = useMachineSnapshot().connection
  const run = useRunProgram()
  const simulateBed = useSimulateBed()
  const start = (
    plate: Plate,
    compiled: CompiledPlate,
    library: readonly Tool[]
  ) => {
    const label = plateLabel(plate, plateIndex(workspace.state, plate.id))
    const runPlate = () => {
      const session = createJobSession(plate, label, compiled, library)
      jobSessionStore.actions.begin(session)
      run.mutate(
        {
          id: session.runId,
          name: toDisplayName(label, "Plate"),
          source: compiled.program.source,
          assists: plate.setup.assists,
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
  return { start, pending: run.isPending || simulateBed.isPending }
}
