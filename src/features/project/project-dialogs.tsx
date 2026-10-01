import { CircleAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { plural } from "@/domain/primitives"
import { AppDialog } from "@/features/shell/app-dialog"
import { closeDialog } from "@/features/shell/dialogs"
import {
  useApplyProject,
  useSaveProject,
  useStartNewProject,
} from "./use-project"
import type { ProjectCandidate } from "./use-project"

/**
 * Replacing a project that has unsaved changes: save them first, discard them, or keep working.
 * `replace` runs once they are saved or discarded.
 */
function SaveChangesDialog({
  title,
  description,
  confirm,
  replace,
}: {
  title: string
  /** What replaces the project. */
  description: string
  /** The label of the button that saves, then replaces the project. */
  confirm: string
  replace: () => void
}) {
  const save = useSaveProject()
  const proceed = () => {
    closeDialog()
    replace()
  }
  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !save.isPending) closeDialog()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description} Unsaved changes to the current project are lost
            otherwise.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction
            variant="outline"
            className="sm:mr-auto"
            disabled={save.isPending}
            onClick={proceed}
          >
            Don’t save
          </AlertDialogAction>
          <AlertDialogCancel autoFocus disabled={save.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: ({ result }) => {
                  if (result.status !== "canceled") proceed()
                },
              })
            }
          >
            {save.isPending ? "Saving…" : confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Opening a project over unsaved changes: save them first, discard them, or keep working. */
export function OpenProjectDialog({
  candidate,
}: {
  candidate: ProjectCandidate
}) {
  const apply = useApplyProject()
  return (
    <SaveChangesDialog
      title="Save changes before opening?"
      description={`Open ${candidate.fileName} with ${plural(candidate.document.plates.length, "plate")}.`}
      confirm="Save and open"
      replace={() => apply.mutate(candidate)}
    />
  )
}

/** Starting a new project over unsaved changes: save them first, discard them, or keep working. */
export function NewProjectDialog() {
  const start = useStartNewProject()
  return (
    <SaveChangesDialog
      title="Save changes before starting a new project?"
      description="Start a new project with an empty Plate 1."
      confirm="Save and start new"
      replace={() => start.mutate()}
    />
  )
}

/** How many of the fields an opened project leaves out the report names. */
const NAMED_FIELDS = 5

/** The fields of the file that the opened project leaves out, which saving does not keep. */
function LeftOutFields({ leftOut }: { leftOut: readonly string[] }) {
  const them = leftOut.length === 1 ? "it" : "them"
  const more = leftOut.length - NAMED_FIELDS
  return (
    <Alert>
      <CircleAlert />
      <AlertTitle>{plural(leftOut.length, "field")} left out</AlertTitle>
      <AlertDescription>
        <p>
          This version of OpenSpindle does not use {them}, and saving the
          project does not keep {them}.
        </p>
        <ul className="list-inside list-disc">
          {leftOut.slice(0, NAMED_FIELDS).map((path, index) => (
            <li key={`${index}:${path}`}>{path}</li>
          ))}
          {more > 0 && <li>{more} more</li>}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

/** What opening a project changed or left out. */
export function ProjectReportDialog({ report }: { report: ProjectCandidate }) {
  return (
    <AppDialog
      title={`Opened ${report.fileName}`}
      description="Review what changed while opening the project."
      onClose={closeDialog}
      footer={<Button onClick={closeDialog}>Done</Button>}
    >
      <div className="flex flex-col gap-3">
        {report.leftOut.length > 0 && (
          <LeftOutFields leftOut={report.leftOut} />
        )}
        {report.notices.map((notice, index) => (
          <Alert key={`${index}:${notice}`}>
            <CircleAlert />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ))}
      </div>
    </AppDialog>
  )
}
