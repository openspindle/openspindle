import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldDescription } from "@/components/ui/field"
import { MachineActionButton, StageCard } from "@/features/job/stage-card"
import { JobFaults, JobProgressDetails } from "@/features/job/job-details"
import { JobStatusBadge } from "@/features/job/job-status-badge"
import { ToolChangePrompt } from "@/features/job/tool-change-prompt"
import { useJobActions } from "@/features/job/job-hooks"
import type { useCalibrationRun } from "./use-calibration-run"

export type CalibrationRunner = ReturnType<typeof useCalibrationRun>

/** The normal runner's live state and tool prompt, hosted inside the guide. */
export function CalibrationRunPanel({
  runner,
  onMeasured,
  contactTitle = "3 · Probe Anchor 1",
  positioningLabel = "Continue to manual positioning",
}: {
  runner: CalibrationRunner
  onMeasured: (offset: number) => void
  contactTitle?: string
  positioningLabel?: string
}) {
  const actions = useJobActions()
  const { record, job, view } = runner
  if (!record) return null
  const ended = !!job && view.kind === "ended"
  const completed =
    ended && job.phase === "completed" && !record.error && !record.cancelled
  const setter = record.stage === "setter"
  const guardAction = (action: typeof actions.resume) => ({
    ...action,
    reason: runner.connectionMatches
      ? action.reason
      : "The original device connection changed. Review the machine before proceeding.",
    run: () => {
      if (runner.connectionMatches) action.run()
    },
  })
  return (
    <StageCard title={setter ? "1 · Tool-setter detection" : contactTitle}>
      {job && view.kind !== "idle" && <JobStatusBadge view={view} />}
      {!job && (
        <FieldDescription>
          {record.pending
            ? "Preparing this temporary run…"
            : "This run is no longer available. Nothing was retried."}
        </FieldDescription>
      )}
      {job && <JobProgressDetails job={job} subject={record.session} />}
      {job && <JobFaults job={job} />}
      {(record.error || job?.error) && (
        <Alert variant="destructive">
          <AlertDescription>{record.error ?? job?.error}</AlertDescription>
        </Alert>
      )}
      {job && view.kind === "waiting-tool" && (
        <ToolChangePrompt
          view={view}
          operation={record.session.plate.operations[0] ?? null}
          confirm={guardAction(actions.confirmToolChange)}
          stop={{
            reason: null,
            pending: runner.stop.isPending,
            run: () => runner.stop.mutate(),
          }}
        />
      )}
      {job &&
        (view.kind === "held" || view.kind === "paused-program") &&
        setter && (
          <MachineActionButton
            action={guardAction(actions.resume)}
            label="Resume measurement"
            icon={null}
          />
        )}
      {completed && setter && (
        <Button
          disabled={runner.continueSetter.isPending}
          onClick={() =>
            runner.continueSetter.mutate(undefined, { onSuccess: onMeasured })
          }
        >
          {positioningLabel}
        </Button>
      )}
      {!runner.busy && (
        <Button
          variant="outline"
          disabled={runner.dismiss.isPending}
          onClick={() => runner.dismiss.mutate()}
        >
          {completed && !setter
            ? "Dismiss temporary result"
            : "Dismiss temporary run"}
        </Button>
      )}
      {completed && setter && (
        <FieldDescription>
          The machine keeps its measured tool offset. Continue verifies the
          tool-sensor contact and current offset; no separate height entry is
          needed.
        </FieldDescription>
      )}
      <FieldDescription>
        This run adds no plate to your project. Automatic bed cleaning is set to
        Off for calibration; check that assist before your next machining job.
      </FieldDescription>
    </StageCard>
  )
}
