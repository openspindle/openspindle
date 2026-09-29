import { Alert, AlertDescription } from "@/components/ui/alert"
import { FieldDescription } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { usePlateIndex } from "@/app/workspace/workspace-context"
import { plateLabel } from "@/domain/plate/plate"
import { JobFaults, JobProgressDetails } from "./job-details"
import { partLabel } from "./job-view"
import type {
  JobOutcome,
  JobSubject,
  JobView,
  JobViewOf,
  TransferStep,
} from "./job-view"
import { StageCard } from "./stage-card"

const TRANSFER_TEXT: Record<
  TransferStep,
  { title: string; description: string }
> = {
  preparing: {
    title: "Preparing the machine",
    description:
      "Checking homing and machine state, then applying the plate's assists.",
  },
  uploading: {
    title: "Uploading the program",
    description: "The program is written to the machine's storage.",
  },
  verifying: {
    title: "Verifying the upload",
    description:
      "Every byte is read back and compared before the program starts.",
  },
  starting: {
    title: "Starting the program",
    description: "Waiting for the machine to report the program running.",
  },
}

const OUTCOME_TEXT: Record<JobOutcome, { title: string; description: string }> =
  {
    completed: {
      title: "Job completed",
      description: "The machine reported the program finished.",
    },
    stopped: {
      title: "Job stopped",
      description:
        "Stop halted the machine. Home it on the Device tab before the next job.",
    },
    failed: {
      title: "Job failed",
      description: "The machine aborted the program.",
    },
    unverified: {
      title: "Completion not verified",
      description:
        "The machine did not confirm how the program ended. Check the machine before running again.",
    },
    lost: {
      title: "Connection lost",
      description:
        "The job may still be running on the machine. Check it before reconnecting.",
    },
  }

/** A program sent as parts has every part written and read back before the first plays. */
function transferText(view: JobViewOf<"transferring">) {
  const part = partLabel(view.job)?.toLowerCase()
  if (part && view.step === "uploading")
    return {
      title: `Uploading ${part}`,
      description:
        "The program is too large for one file, so it is sent in parts split at its tool changes. Every part is written to the machine's storage before the first plays.",
    }
  if (part && view.step === "verifying")
    return { ...TRANSFER_TEXT.verifying, title: `Verifying ${part}` }
  return TRANSFER_TEXT[view.step]
}

export function TransferStage({ view }: { view: JobViewOf<"transferring"> }) {
  const text = transferText(view)
  return (
    <StageCard title={text.title} description={text.description}>
      {view.percent !== null && (
        <Progress value={view.percent} aria-label="Transfer progress" />
      )}
    </StageCard>
  )
}

export function FinishingStage({ view }: { view: JobViewOf<"finishing"> }) {
  return (
    <StageCard
      title={view.cleaning ? "Cleaning the bed" : "Finishing"}
      description={
        view.cleaning
          ? "Bed cleaning runs after the program. The job completes when the machine reports it done."
          : "The last blocks are running. The job completes when the machine confirms it."
      }
    >
      <JobProgressDetails job={view.job} subject={view.session} />
      {view.job.overdue && (
        <Alert>
          <AlertDescription>
            This takes longer than expected. The job is still tracked; check the
            machine.
          </AlertDescription>
        </Alert>
      )}
      <JobFaults job={view.job} />
    </StageCard>
  )
}

export function EndedStage({ view }: { view: JobViewOf<"ended"> }) {
  const text = OUTCOME_TEXT[view.outcome]
  const error = view.job.error
  return (
    <StageCard
      title={text.title}
      description={error ? undefined : text.description}
    >
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <JobProgressDetails job={view.job} subject={view.session} />
      <JobFaults job={view.job} />
    </StageCard>
  )
}

/** The plate the tab is about; the job's phase shows in its toolbar. */
export function JobSummary({
  view,
  subject,
}: {
  view: JobView
  subject: JobSubject | null
}) {
  const index = usePlateIndex(subject?.plate.id)
  if (view.kind === "idle")
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="truncate">
          {subject ? plateLabel(subject.plate, index) : "No plate"}
        </h2>
      </div>
    )
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h2 className="truncate">{view.session?.label ?? view.job.name}</h2>
      <FieldDescription className="font-numeric">
        {view.session
          ? `Run at ${new Date(view.job.startedAt).toLocaleTimeString()}`
          : "Started outside this window; its plate is unknown here."}
      </FieldDescription>
    </div>
  )
}
