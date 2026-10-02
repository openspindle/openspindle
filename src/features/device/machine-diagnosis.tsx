import { useState } from "react"
import { createAtom, useSelector } from "@tanstack/react-store"
import {
  CircleAlert,
  House,
  LockOpen,
  Play,
  RotateCcw,
  ScanSearch,
  Square,
  TriangleAlert,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { MachineEvidence } from "@/domain/diagnosis/evidence"
import type { Resolution } from "@/domain/diagnosis/resolution"
import { kitForDevice } from "@/domain/fixtures/catalog"
import { rulesOf } from "@/domain/rules/rules"
import { runRules } from "@/machine/contract"
import type {
  ReportedSeverity,
  SwitchReport,
  Telemetry,
} from "@/machine/contract"
import {
  useFreshTelemetry,
  useMachineCommand,
  useMachineSnapshot,
  useReadSwitches,
  useResetMachine,
  useStopMachine,
} from "@/platform/machine"
import { availabilityReason } from "@/features/job/job-hooks"
import type { MachineAction } from "@/features/job/job-hooks"
import { MachineActionButton } from "@/features/job/stage-card"
import { ResetMachineDialog } from "./reset-machine-dialog"

/** What the machine's status says it is doing; what an inspection read holds while it stays. */
const stateKey = (telemetry: Telemetry | null) =>
  telemetry ? `${telemetry.state}:${telemetry.alarm ?? ""}` : null

/** The last switch read, with the connection and the machine state it was read in. */
const switchesAtom = createAtom<{
  readonly connectionId: string | null
  readonly state: string | null
  readonly report: SwitchReport
} | null>(null)

/**
 * What is known about the connected machine. What an inspection read counts while the
 * connection and the machine's state stay as they were: a machine that unlocked or homed since
 * may read otherwise.
 */
function useMachineEvidence(): MachineEvidence {
  const { connection, lockout } = useMachineSnapshot()
  const telemetry = useFreshTelemetry()
  const inspected = useSelector(switchesAtom)
  const model = connection.device?.model
  return {
    telemetry,
    lockout: lockout?.reason ?? null,
    kit: (model && kitForDevice(model)) || null,
    switches:
      inspected?.connectionId === connection.id &&
      inspected.state === stateKey(telemetry)
        ? inspected.report
        : null,
  }
}

/** A finding as views show it: what it is, what it means, and what resolves it. */
type Finding = {
  readonly id: string
  readonly severity: ReportedSeverity
  readonly title: string
  readonly problem: string
  readonly advice?: string
  readonly resolutions: readonly Resolution[]
}

/**
 * The connected machine's findings, as the diagnosis rules find them in what is known about
 * it: those for every machine, and its kit's own. A device without a kit has only the former.
 */
function useMachineFindings(): Finding[] {
  const evidence = useMachineEvidence()
  return runRules(rulesOf("diagnosis"), [evidence], {
    machine: evidence.kit?.id ?? "",
  }).map((failure) => {
    const { rule } = failure
    const { title, problem, advice } = rule.explain(failure)
    return {
      id: rule.id,
      severity: failure.severity,
      title: title ?? rule.label,
      problem,
      ...(advice && { advice }),
      resolutions: rule.fixes?.offer(failure) ?? [],
    }
  })
}

const report = (error: Error) => toast.error(error.message)

/** A resolution's icon: a command's as the Device page shows it. */
function iconOf(resolution: Resolution): LucideIcon {
  switch (resolution.kind) {
    case "command":
      if (resolution.command.type === "unlock") return LockOpen
      if (resolution.command.type === "home") return House
      return Play
    case "reset":
      return RotateCcw
    case "stop":
      return Square
    case "inspect":
      return ScanSearch
  }
}

/**
 * The resolutions of the findings as machine actions, each enabled as the machine's
 * availability says; Reset asks first. What an inspection reads becomes evidence.
 */
function useResolutions() {
  const { availability, connection } = useMachineSnapshot()
  const telemetry = useFreshTelemetry()
  const command = useMachineCommand()
  const reset = useResetMachine()
  const stop = useStopMachine()
  const readSwitches = useReadSwitches()
  const [confirmReset, setConfirmReset] = useState(false)
  const action = (resolution: Resolution): MachineAction => {
    switch (resolution.kind) {
      case "command":
        return {
          reason: availabilityReason(availability[resolution.command.type]),
          pending: command.isPending,
          run: () =>
            command.mutate(resolution.command, {
              onSuccess: () => {
                if (resolution.afterwards)
                  toast.success(resolution.label, {
                    description: resolution.afterwards,
                  })
              },
              onError: report,
            }),
        }
      case "reset":
        return {
          reason: availabilityReason(availability.reset),
          pending: reset.isPending,
          run: () => setConfirmReset(true),
        }
      case "stop":
        return {
          reason: availabilityReason(availability.stop),
          pending: stop.isPending,
          run: () => stop.mutate(undefined, { onError: report }),
        }
      case "inspect":
        return {
          reason: availabilityReason(availability.readSwitches),
          pending: readSwitches.isPending,
          run: () => {
            const read = {
              connectionId: connection.id,
              state: stateKey(telemetry),
            }
            readSwitches.mutate(undefined, {
              onSuccess: (switches) =>
                switchesAtom.set(() => ({ ...read, report: switches })),
              onError: report,
            })
          },
        }
    }
  }
  const dialog = (
    <ResetMachineDialog
      open={confirmReset}
      onOpenChange={setConfirmReset}
      onReset={() => reset.mutate(undefined, { onError: report })}
    />
  )
  return { action, dialog }
}

/**
 * What is wrong with the connected machine, a finding each: what it is and means, what to do,
 * and the actions that resolve it.
 */
export function MachineDiagnosis() {
  const findings = useMachineFindings()
  const { action, dialog } = useResolutions()
  if (!findings.length) return null
  return (
    <>
      {findings.map((finding) => {
        const Icon = finding.severity === "error" ? CircleAlert : TriangleAlert
        return (
          <Alert
            key={finding.id}
            variant={finding.severity === "error" ? "destructive" : "warning"}
            role="alert"
          >
            <Icon />
            <AlertTitle>{finding.title}</AlertTitle>
            <AlertDescription className="flex flex-col gap-1 [&_p:not(:last-child)]:mb-0">
              <p>{finding.problem}</p>
              {finding.advice && <p>{finding.advice}</p>}
              {finding.resolutions.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {finding.resolutions.map((resolution) => {
                    const ResolutionIcon = iconOf(resolution)
                    return (
                      <MachineActionButton
                        key={resolution.label}
                        action={action(resolution)}
                        label={resolution.label}
                        size="sm"
                        icon={<ResolutionIcon data-icon="inline-start" />}
                      />
                    )
                  })}
                </div>
              )}
            </AlertDescription>
          </Alert>
        )
      })}
      {dialog}
    </>
  )
}
