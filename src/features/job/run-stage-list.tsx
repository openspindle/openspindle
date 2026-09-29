import type { ReactNode } from "react"
import {
  CircleCheck,
  CircleDashed,
  CircleMinus,
  CirclePause,
  CircleX,
  Square,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { formatMillimetres } from "@/domain/auto-level/params"
import type { Operation } from "@/domain/operations/operation"
import { PROBE_3D_CORNER_LABELS, findsCorner } from "@/domain/probe-3d/params"
import type { Probe3dParams } from "@/domain/probe-3d/params"
import { probe3dResult } from "@/domain/probe-3d/result"
import { placementHeight } from "@/domain/probing/placement"
import { PROBE_3D_TOOL, PROBE_TOOL } from "@/domain/tools/tool-table"
import { programParts } from "@/machine/contract"
import type {
  ContactsMeasurement,
  GridMeasurement,
  HeightMap,
  JobState,
} from "@/machine/contract"
import type { Tool } from "@/domain/tools/tool"
import { cn } from "@/lib/utils"
import {
  HeightMapFacts,
  HeightMapGrid,
} from "@/components/workspace/height-map-grid"
import { operationKindLabel } from "@/features/plugins/use-operation-kind-label"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"
import { useInstalledPlugins } from "@/platform/plugins"
import { HeightMapReviewStep } from "./height-map-review-step"
import { JobFaults, JobProgressDetails } from "./job-details"
import type { JobActions } from "./job-hooks"
import { EndedStage, FinishingStage, TransferStage } from "./job-stages"
import type { JobSubject, JobView } from "./job-view"
import { PausePrompt } from "./pause-prompt"
import { RunChecklistCard } from "./run-checklist-card"
import type { RunChecklist } from "./run-checklist"
import { runStages } from "./run-stages"
import type { OperationStage, StageStatus } from "./run-stages"
import { StageCard } from "./stage-card"
import { ToolChangePrompt } from "./tool-change-prompt"

const STATUS: Record<StageStatus, { label: string; icon: LucideIcon | null }> =
  {
    pending: { label: "Up next", icon: CircleDashed },
    active: { label: "Running", icon: null },
    waiting: { label: "Waiting", icon: CirclePause },
    done: { label: "Done", icon: CircleCheck },
    failed: { label: "Failed", icon: CircleX },
    stopped: { label: "Stopped", icon: Square },
    skipped: { label: "Not run", icon: CircleMinus },
  }

/** A stage that is not the current one: its status, what it does or did, and its results. */
function StageItem({
  title,
  status,
  description,
  children,
}: {
  title: string
  status: StageStatus
  description?: ReactNode
  children?: ReactNode
}) {
  const { label, icon: Icon } = STATUS[status]
  return (
    <Card
      size="sm"
      role="region"
      aria-label={title}
      data-status={status}
      className={cn(
        (status === "pending" || status === "skipped") && "opacity-70"
      )}
    >
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <Icon className="size-4 shrink-0" aria-hidden />
          ) : (
            <Spinner className="size-4 shrink-0" aria-hidden />
          )}
          <span className="truncate">{title}</span>
        </CardTitle>
        <CardAction className="text-muted-foreground">{label}</CardAction>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {/* Details that render nothing leave no empty section behind. */}
      <CardContent className="flex flex-col gap-3 empty:hidden">
        {children}
      </CardContent>
    </Card>
  )
}

const mm = (value: number) => formatMillimetres(Number(value.toFixed(3)))

/** What an operation does, before it has run. */
function operationSummary(
  operation: Operation,
  subject: JobSubject,
  tools: readonly Tool[],
  plugins: readonly PluginSummary[] | undefined
): string {
  const { source } = operation
  switch (source.kind) {
    case "auto-z-height": {
      const { placement } = source.params
      const where =
        placement.kind === "anchor"
          ? `at ${anchorName(subject, placement.anchorId)} + X${mm(placement.offset.x)} Y${mm(placement.offset.y)}`
          : "below the probe"
      return `Touches the stock top ${where} and sets work Z there.`
    }
    case "auto-level": {
      const { columns, rows, width, depth } = source.params
      return `Probes ${columns} × ${rows} points over ${mm(width)} × ${mm(depth)} mm.`
    }
    case "probe-3d": {
      const { placement } = source.params
      const height = placementHeight(placement)
      const z = height === undefined ? "" : ` Z${mm(height)}`
      const where =
        placement.kind === "anchor"
          ? `from ${anchorName(subject, placement.anchorId)} + X${mm(placement.offset.x)} Y${mm(placement.offset.y)}${z}`
          : `from the probe position${z && ` at${z}`}`
      return `Finds ${probe3dTarget(source.params)} ${where} and sets the work origin there.`
    }
    default: {
      const names = toolNames(operation, subject, tools)
      return names.length
        ? names.join(", ")
        : `${operationKindLabel(operation, plugins)} with no tool change.`
    }
  }
}

function anchorName(subject: JobSubject, anchorId: string): string {
  return (
    subject.plate.setup.anchors?.anchors.find(
      (anchor) => anchor.id === anchorId
    )?.name ?? "its anchor"
  )
}

/** "T1 · name" for each tool the operation's program changes to, as the plate was run. */
function toolNames(
  operation: Operation,
  subject: JobSubject,
  tools: readonly Tool[]
): string[] {
  return [
    ...new Set(
      subject.compiled.sections
        .filter(
          (section) =>
            section.kind === "tool-change" &&
            section.operationId === operation.id &&
            section.tool !== null
        )
        .map((section) => section.tool as number)
    ),
  ].map((number) => {
    const toolId = subject.plate.tools.find(
      (entry) => entry.number === number
    )?.toolId
    const tool = tools.find((item) => item.id === toolId)
    return tool ? `T${number} · ${tool.name}` : `T${number}`
  })
}

/** A probed grid as the height-map table shows it; unmeasured points stay empty. */
const gridMap = (grid: GridMeasurement): HeightMap => ({
  columns: grid.columns,
  rows: grid.rows,
  heights: grid.heights,
  xCoordinates: grid.xCoordinates,
  yCoordinates: grid.yCoordinates,
  raw: "",
  receivedAt: grid.at,
  deviceId: "job",
})

/** How far the machine got with a grid. */
function gridText(grid: GridMeasurement): string {
  switch (grid.status) {
    case "probing":
      return "The machine is probing the grid."
    case "failed":
      return "The machine could not finish the grid."
    case "completed":
      return "The machine measured the grid and compensates Z for it."
  }
}

/** What a 3D probing operation finds, in words. */
function probe3dTarget({ routine, corner, axes }: Probe3dParams): string {
  const at = PROBE_3D_CORNER_LABELS[corner].toLowerCase()
  const across = axes === "xy" ? "X and Y" : axes.toUpperCase()
  switch (routine) {
    case "outside-corner":
      return `the ${at} corner`
    case "inside-corner":
      return `the ${at} inside corner`
    case "pocket-center":
      return `the pocket's center in ${across}`
    case "boss-center":
      return `the boss's center in ${across}`
  }
}

/** What a 3D probing routine that has not found what it probes did, by its stage's status. */
function probe3dUnfinished(params: Probe3dParams, status: StageStatus) {
  const target = probe3dTarget(params)
  switch (status) {
    case "failed":
    case "stopped":
      return `The machine stopped probing ${target} before it found it.`
    case "done":
      return `The machine did not report every contact of the routine, so where it found ${target} is unknown.`
    default:
      return `The machine is probing ${target}.`
  }
}

/** Where a 3D probing routine set the work origin, from the contacts it reported. */
function probe3dFacts(
  params: Probe3dParams,
  { contacts }: ContactsMeasurement,
  status: StageStatus
): { description: string; facts: { label: string; value: string }[] } {
  const result = probe3dResult(params, contacts)
  const set = (["X", "Y"] as const).flatMap((axis, index) => {
    const value = result.origin[index]
    return value === null ? [] : [{ axis, value }]
  })
  const facts: { label: string; value: string }[] = []
  if (result.top !== null)
    facts.push({ label: "Top", value: `Z ${mm(result.top)}` })
  const size = result.size.filter((value) => value !== null)
  if (size.length)
    facts.push({
      label: params.routine === "pocket-center" ? "Pocket" : "Boss",
      value: `${size.map(mm).join(" × ")} mm`,
    })
  facts.push({ label: "Contacts", value: String(contacts.length) })
  if (!result.complete || !set.length)
    return { description: probe3dUnfinished(params, status), facts }
  const zero = set.map(({ axis }) => `${axis}0`).join(" ")
  const at = set.map(({ axis, value }) => `${axis} ${mm(value)}`).join(" ")
  const top = result.top === null ? "" : " and Z0 on the top it touched"
  const found = findsCorner(params.routine) ? "corner" : "center"
  return {
    description: `Found the ${found} and set work ${zero} there, at machine ${at}${top}.`,
    facts,
  }
}

/** A tool measured at the tool sensor, by what it is. */
function sensorLabel(tool: number | null): string {
  if (tool === PROBE_TOOL) return "Probe at sensor"
  if (tool === PROBE_3D_TOOL) return "3D probe at sensor"
  if (tool === null) return "Tool at sensor"
  return `T${tool} at sensor`
}

/** What the machine measured in an operation, or what it will do there. */
function operationResults(
  stage: OperationStage,
  subject: JobSubject,
  tools: readonly Tool[],
  plugins: readonly PluginSummary[] | undefined
): { description: string; details: ReactNode } {
  const { operation, surface, grid, contacts, status } = stage
  const facts: { label: string; value: string }[] = []
  let description: string | null = null
  if (contacts && operation.source.kind === "probe-3d") {
    const probed = probe3dFacts(operation.source.params, contacts, status)
    description = probed.description
    facts.push(...probed.facts)
  }
  if (surface) {
    const [x, y, z] = surface.machine
    description = `Touched the stock top at machine X ${mm(x)} Y ${mm(y)} and set work Z0 there.`
    facts.push({ label: "Stock top", value: `Z ${mm(z)}` })
  }
  if (grid) {
    const measured = grid.heights
      .flat()
      .filter((value) => value !== null).length
    description = gridText(grid)
    facts.push(
      { label: "Grid", value: `${grid.columns} × ${grid.rows}` },
      { label: "Measured", value: `${measured} / ${grid.columns * grid.rows}` }
    )
    if (grid.range !== null)
      facts.push({ label: "Range", value: `${mm(grid.range)} mm` })
  }
  for (const tool of stage.tools)
    facts.push({
      label: sensorLabel(tool.tool),
      value: `Z ${mm(tool.machine[2])}`,
    })
  const probing =
    operation.source.kind === "auto-z-height" ||
    operation.source.kind === "auto-level"
  if (!surface && !grid && status === "done" && probing)
    description =
      "The machine reports its measurements only when it probes from a stored anchor with the work origin kept relative to one."
  return {
    description:
      description ?? operationSummary(operation, subject, tools, plugins),
    details: (
      <>
        {facts.length > 0 && <HeightMapFacts facts={facts} />}
        {grid && <HeightMapGrid map={gridMap(grid)} compact />}
      </>
    ),
  }
}

function OperationItem({
  stage,
  subject,
  tools,
}: {
  stage: OperationStage
  subject: JobSubject
  tools: readonly Tool[]
}) {
  const plugins = useInstalledPlugins().data
  const { description, details } = operationResults(
    stage,
    subject,
    tools,
    plugins
  )
  return (
    <StageItem
      title={stage.operation.name}
      status={stage.status}
      description={description}
    >
      {details}
    </StageItem>
  )
}

/** The current operation while the machine runs it on its own: progress, results so far. */
function RunningOperation({
  view,
  stage,
  subject,
  tools,
}: {
  view: Extract<JobView, { kind: "running" }>
  stage: OperationStage | null
  subject: JobSubject | null
  tools: readonly Tool[]
}) {
  const plugins = useInstalledPlugins().data
  const results =
    stage && subject ? operationResults(stage, subject, tools, plugins) : null
  return (
    <StageCard
      title={stage?.operation.name ?? "Running"}
      description={
        results?.description ??
        "The machine runs the program; the timeline follows its line."
      }
    >
      <JobProgressDetails
        job={view.job}
        subject={view.session}
        withOperation={!stage}
      />
      {results?.details}
      <JobFaults job={view.job} />
    </StageCard>
  )
}

/** The prompt or progress of the stage the job is in, which replaces its compact card. */
function CurrentStage({
  view,
  stage,
  subject,
  tools,
  actions,
}: {
  view: JobView
  stage: OperationStage | null
  subject: JobSubject | null
  tools: readonly Tool[]
  actions: JobActions
}) {
  switch (view.kind) {
    case "running":
      return (
        <RunningOperation
          view={view}
          stage={stage}
          subject={subject}
          tools={tools}
        />
      )
    case "waiting-tool":
      return (
        <ToolChangePrompt
          view={view}
          operation={stage?.operation ?? null}
          confirm={actions.confirmToolChange}
        />
      )
    case "waiting-review":
      return <HeightMapReviewStep view={view} />
    case "paused-before-operation":
    case "paused-program":
    case "held":
      return <PausePrompt view={view} />
    default:
      return null
  }
}

/** The end of the run: its progress while it finishes, its outcome once it has ended. */
function FinishItem({ view, status }: { view: JobView; status: StageStatus }) {
  if (view.kind === "finishing") return <FinishingStage view={view} />
  if (view.kind === "ended") return <EndedStage view={view} />
  return (
    <StageItem
      title="Finish"
      status={status}
      description="The job completes when the machine confirms the program ended."
    />
  )
}

/** What the upload sent: every file, and how many when the program went as parts. */
function uploadedText(job: JobState): string {
  const parts = programParts(job.program)
  const bytes = parts.reduce((sum, part) => sum + part.bytes, 0)
  const size = `${(bytes / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kB`
  return parts.length > 1
    ? `${size} in ${parts.length} parts written and read back.`
    : `${size} written and read back.`
}

/**
 * The run as stages, one card each: the checks before Run, the upload, every operation of the
 * plate with what the machine measured in it, and the end. The stage the job is in shows its
 * prompt or progress; the others stay compact. The job's controls are in its toolbar.
 */
export function RunStageList({
  view,
  subject,
  tools,
  actions,
  checklist,
  parts,
}: {
  view: JobView
  subject: JobSubject | null
  /** The library tools the plate's tool table names: the Run session's during a job. */
  tools: readonly Tool[]
  actions: JobActions
  checklist: RunChecklist
  /** The files the checked program is sent as. */
  parts: number
}) {
  const stages = runStages(view, subject)
  const operations = stages.operations
  const current =
    operations?.findIndex(
      (stage) => stage.status === "active" || stage.status === "waiting"
    ) ?? -1
  const inOperation =
    view.kind !== "idle" &&
    view.kind !== "transferring" &&
    view.kind !== "finishing" &&
    view.kind !== "ended"
  const prompt = inOperation ? (
    <CurrentStage
      view={view}
      stage={current >= 0 ? operations![current] : null}
      subject={subject}
      tools={tools}
      actions={actions}
    />
  ) : null
  return (
    <ol className="flex flex-col gap-2" aria-label="Run stages">
      <li>
        {view.kind === "idle" ? (
          <RunChecklistCard
            parts={parts}
            checklist={checklist}
            readAnchors={actions.readAnchors}
          />
        ) : (
          <StageItem
            title="Checks"
            status={stages.preflight}
            description={`Passed before Run at ${new Date(view.job.startedAt).toLocaleTimeString()}.`}
          />
        )}
      </li>
      <li>
        {view.kind === "transferring" ? (
          <TransferStage view={view} />
        ) : (
          <StageItem
            title="Upload"
            status={stages.transfer}
            description={
              view.kind === "idle"
                ? "The program is written to the machine's storage and read back before it starts."
                : uploadedText(view.job)
            }
          />
        )}
      </li>
      {/* Before the first operation, or for a job whose plate is unknown here. */}
      {prompt && current < 0 && <li>{prompt}</li>}
      {subject &&
        operations?.map((stage, index) => (
          <li key={stage.operation.id}>
            {index === current && prompt ? (
              prompt
            ) : (
              <OperationItem stage={stage} subject={subject} tools={tools} />
            )}
          </li>
        ))}
      <li>
        <FinishItem view={view} status={stages.finish} />
      </li>
    </ol>
  )
}
