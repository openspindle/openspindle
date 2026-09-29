import { useEffect, useMemo } from "react"
import { useDefaultLayout } from "react-resizable-panels"
import { FileCode } from "lucide-react"
import {
  useCompiledPlate,
  useSelectedPlate,
  useWorkspace,
} from "@/app/workspace/workspace-context"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { MachineConsole } from "./machine-console"
import { useMachineSnapshot } from "@/platform/machine"
import { CutFacts } from "./cut-facts"
import { GCodeListing } from "./gcode-listing"
import { JobCamera } from "./job-camera"
import { useJobActions, useRunChecklist, useRunJob } from "./job-hooks"
import type { MachineAction } from "./job-hooks"
import { JobSummary } from "./job-stages"
import { JobTimelineBar } from "./job-timeline"
import { JobToolbar } from "./job-toolbar"
import { followTarget, jobSubject } from "./job-view"
import type { JobSubject, JobView } from "./job-view"
import { JobViewer } from "./job-viewer"
import { preparedProgram, useCompiledProgramCheck } from "./program-check"
import { RunStageList } from "./run-stage-list"
import type { ProgramCheck } from "./program-check"
import { useCutPrediction } from "./use-cut-prediction"
import { useJobTimeline } from "./use-job-timeline"
import type { JobTimeline } from "./use-job-timeline"
import { useJobView } from "./use-job-view"

/** The job panel: the job's controls on top, then its stages from the checks to its end. */
function JobPanel({
  view,
  subject,
  check,
}: {
  view: JobView
  subject: JobSubject | null
  check: ProgramCheck
}) {
  const { lockout } = useMachineSnapshot()
  const actions = useJobActions()
  const runJob = useRunJob()
  const library = useWorkspace((state) => state.tools)
  const checklist = useRunChecklist(
    subject?.plate ?? null,
    subject?.compiled ?? null,
    check
  )
  const run: MachineAction = {
    reason: checklist.blocker,
    pending: runJob.pending,
    run: () => {
      if (subject && checklist.ready)
        runJob.start(subject.plate, subject.compiled, library)
    },
  }
  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      aria-label="Job"
    >
      <JobToolbar view={view} actions={actions} run={run} />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          <JobSummary view={view} subject={subject} />
          {lockout && (
            <Alert variant="destructive">
              <AlertDescription>{lockout.reason}</AlertDescription>
            </Alert>
          )}
          <RunStageList
            view={view}
            subject={subject}
            tools={
              view.kind !== "idle" && view.session
                ? view.session.tools
                : library
            }
            actions={actions}
            checklist={checklist}
            parts={Math.max(1, preparedProgram(check)?.parts.length ?? 1)}
          />
        </div>
      </ScrollArea>
    </aside>
  )
}

/** The G-code the job runs, above the machine console. */
function ProgramPanel({
  subject,
  check,
  timeline,
}: {
  subject: JobSubject | null
  check: ProgramCheck
  timeline: JobTimeline
}) {
  const layout = useDefaultLayout({
    id: "openspindle-job-program",
    panelIds: ["job-code", "job-console"],
    onlySaveAfterUserInteractions: true,
  })
  return (
    <ResizablePanelGroup
      orientation="vertical"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <ResizablePanel id="job-code" minSize={120}>
        {subject ? (
          <GCodeListing
            compiled={subject.compiled}
            operations={subject.plate.operations}
            check={check}
            line={timeline.line}
            onSeekLine={timeline.seekLine}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileCode />
              </EmptyMedia>
              <EmptyTitle>No program</EmptyTitle>
              <EmptyDescription>
                Add a plate with operations in Prepare.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize console" />
      <ResizablePanel id="job-console" defaultSize="30" minSize={96}>
        <MachineConsole />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

/**
 * The Job tab: preview and run a plate, then follow the job on the machine, handle its tool
 * changes, pauses and height-map reviews, and dismiss it when it ends. The job panel is on the
 * left, the 3D view and its timeline in the middle, and the G-code and console on the right.
 */
export function JobPage({
  requestedLine,
  onRequestedLineShown,
}: {
  /** A program line to show once, for example from a deep link. */
  requestedLine: number | null
  onRequestedLineShown: () => void
}) {
  const view = useJobView()
  const selectedPlate = useSelectedPlate()
  const selectedCompiled = useCompiledPlate(selectedPlate)
  const selected = useMemo(
    () =>
      selectedPlate && selectedCompiled
        ? { plate: selectedPlate, compiled: selectedCompiled }
        : null,
    [selectedPlate, selectedCompiled]
  )
  const subject = jobSubject(view, selected)
  const check = useCompiledProgramCheck(subject?.compiled ?? null)
  const timeline = useJobTimeline(subject, followTarget(view))
  const prediction = useCutPrediction(subject)
  const layout = useDefaultLayout({
    id: "openspindle-job",
    panelIds: ["job-panel", "job-viewer", "job-program"],
    onlySaveAfterUserInteractions: true,
  })

  const { seekLine } = timeline
  // Only a new request seeks; the callbacks of the render that carried it are current.
  useEffect(() => {
    if (requestedLine === null) return
    seekLine(requestedLine)
    onRequestedLineShown()
  }, [requestedLine])

  return (
    <ResizablePanelGroup
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
    >
      <ResizablePanel
        id="job-panel"
        defaultSize={400}
        minSize={320}
        maxSize={640}
        groupResizeBehavior="preserve-pixel-size"
      >
        <JobPanel view={view} subject={subject} check={check} />
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize job panel" />
      <ResizablePanel id="job-viewer" minSize={320}>
        <main
          className="relative flex h-full min-h-0 min-w-0 flex-col"
          aria-label="Job preview"
        >
          <JobViewer
            shown={subject}
            preview={timeline.preview}
            playhead={timeline.playhead}
          />
          <JobTimelineBar
            timeline={timeline}
            details={
              <CutFacts
                subject={subject}
                prediction={prediction}
                line={timeline.line}
              />
            }
          />
          <JobCamera />
        </main>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize G-code panel" />
      <ResizablePanel
        id="job-program"
        defaultSize={360}
        minSize={280}
        maxSize={640}
        groupResizeBehavior="preserve-pixel-size"
      >
        <ProgramPanel subject={subject} check={check} timeline={timeline} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
