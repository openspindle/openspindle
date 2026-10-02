import { TriangleAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { FieldDescription } from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import type { JobState } from "@/machine/contract"
import { formatDuration } from "./format"
import {
  partLabel,
  playedLine,
  positionLabel,
  programPosition,
} from "./job-view"
import type { JobSubject, ProgramPosition } from "./job-view"

/** The position's label, as the timeline names its markers; the operation only when asked. */
const positionText = (
  { operation, section }: ProgramPosition,
  withOperation: boolean
) => positionLabel(withOperation ? operation : null, section)

/**
 * Where the job is, as the machine reports it: the player's line of the prepared line count
 * and the elapsed time. With the job's own session, also the operation and section.
 */
export function JobProgressDetails({
  job,
  subject,
  withOperation = true,
}: {
  job: JobState
  /** The plate as run; null for a job this window did not start. */
  subject: JobSubject | null
  /** Name the operation too; not in a card that is the operation's own. */
  withOperation?: boolean
}) {
  const progress = job.progress
  if (!progress) return null
  const line = playedLine(job, subject) ?? progress.line
  const position = subject
    ? positionText(programPosition(subject, line), withOperation)
    : null
  const part = partLabel(job)
  return (
    <div className="flex flex-col gap-2">
      <Progress value={progress.percent} aria-label="Program progress" />
      <FieldDescription className="flex justify-between gap-3 font-numeric">
        <span>
          Line {line.toLocaleString()} of{" "}
          {job.program.lineCount.toLocaleString()}
          {part && ` · ${part.toLowerCase()}`}
        </span>
        <span>{formatDuration(progress.elapsedSeconds)}</span>
      </FieldDescription>
      {position && <FieldDescription>{position}</FieldDescription>}
    </div>
  )
}

const MAX_LISTED_FAULTS = 5

/** Errors the machine reported for played lines. */
export function JobFaults({ job }: { job: JobState }) {
  const count = job.faults.length
  if (!count) return null
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>
        {count === 1
          ? "The machine reported an error"
          : `The machine reported ${count} errors`}
      </AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1">
          {job.faults.slice(0, MAX_LISTED_FAULTS).map((fault, index) => (
            <li key={index}>
              {fault.line !== null && (
                <span className="font-numeric">Line {fault.line}: </span>
              )}
              {fault.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
