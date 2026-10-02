import { Fragment } from "react"
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
import { AxisLabel, AxisValue } from "@/components/workspace/axis-label"
import { numberText } from "@/features/device/device-format"
import { formatMillimetres } from "@/domain/geometry/millimetres"
import type { Operation } from "@/domain/operations/operation"
import {
  PROBE_3D_CORNER_LABELS,
  findsCorner,
} from "@/domain/probing/tasks/origin/params"
import type { OriginParams } from "@/domain/probing/tasks/origin/params"
import {
  foundPosition,
  originResult,
} from "@/domain/probing/tasks/origin/result"
import { placementHeight } from "@/domain/probing/placement"
import { outlineTarget } from "@/domain/probing/tasks/outline/params"
import { itemEdges, sameEdge } from "@/domain/plate/item-edges"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { methodFor } from "@/domain/probing/strategies"
import {
  PROBE_3D_TOOL,
  PROBE_TOOL,
  boundTools,
} from "@/domain/tools/tool-table"
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
import { operationKindLabel } from "@/features/prepare/use-operation-kind-label"
import type { OperationSettings } from "@/domain/compile/operation-settings"
import { HeightMapReviewStep } from "./height-map-review-step"
import { JobFaults, JobProgressDetails } from "./job-details"
import {
  OperationSettingsRow,
  useOperationSettings,
} from "./operation-settings"
import type { JobActions } from "./job-hooks"
import { EndedStage, FinishingStage, TransferStage } from "./job-stages"
import type { JobSubject, JobView } from "./job-view"
import { PausePrompt } from "./pause-prompt"
import { RunChecklistCard } from "./run-checklist-card"
import { SaveAsAnchor } from "./save-as-anchor"
import type { RunChecklist } from "./run-checklist"
import { useReadAnchorsFix } from "@/features/prepare/quick-fix"
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

/** A coordinate as the Device page's coordinates show it: to three decimals, a micrometre. */
const coordinate = (value: number) => numberText(value, 3)

/** A stored anchor and the X and Y from it, each axis as `AxisValue` sets it. */
function AnchorOffset({
  name,
  offset,
}: {
  name: string
  offset: readonly number[]
}) {
  return (
    <>
      {name} + <AxisValue axis="X" value={coordinate(offset[0])} />{" "}
      <AxisValue axis="Y" value={coordinate(offset[1])} />
    </>
  )
}

/** What an operation does, before it has run. */
function operationSummary(
  operation: Operation,
  subject: JobSubject,
  tools: readonly Tool[]
): ReactNode {
  const { source } = operation
  const probing = source.kind === "probing" ? source : null
  switch (probing?.task) {
    case "touch-off": {
      const { placement } = probing.params
      return (
        <>
          Touches the stock top{" "}
          {placement.kind === "anchor" ? (
            <>
              at{" "}
              <AnchorOffset
                name={anchorName(subject, placement.anchorId)}
                offset={placement.offset}
              />
            </>
          ) : (
            "below the probe"
          )}{" "}
          and sets work <AxisLabel axis="Z" /> there.
        </>
      )
    }
    case "grid": {
      const [columns, rows] = probing.params.points
      const [width, depth] = probing.params.size
      return `Probes ${columns} × ${rows} points over ${mm(width)} × ${mm(depth)} mm.`
    }
    case "outline": {
      const target = outlineTarget(probing.params)
      if (target.kind === "toolpath")
        return "Traces the plate's toolpath bounds with the probe's pointer."
      const edges = itemEdges(subject.plate.setup)
      const names = target.edges.map(
        (ref) =>
          edges.find((edge) => sameEdge(edge.ref, ref))?.label ??
          `a missing ${ref.side} edge`
      )
      return `Traces ${names.join(", ")} with the probe's pointer.`
    }
    case "origin": {
      const { placement } = probing.params
      const height = placementHeight(placement)
      const z = height !== undefined && (
        <AxisValue axis="Z" value={coordinate(height)} />
      )
      return (
        <>
          Finds {probe3dTarget(probing.params)}{" "}
          {placement.kind === "anchor" ? (
            <>
              from{" "}
              <AnchorOffset
                name={anchorName(subject, placement.anchorId)}
                offset={placement.offset}
              />
              {z && <> {z}</>}
            </>
          ) : (
            <>from the probe position{z && <> at {z}</>}</>
          )}{" "}
          and sets the work origin there.
        </>
      )
    }
    default: {
      const names = toolNames(operation, subject, tools)
      return names.length
        ? names.join(", ")
        : `${operationKindLabel(operation)} with no tool change.`
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
function probe3dTarget({ routine, corner, axes }: OriginParams): string {
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
function probe3dUnfinished(params: OriginParams, status: StageStatus) {
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

/** A labelled value of an operation's results. */
type Fact = { label: string; value: ReactNode }

/** A machine Z, its axis in its colour. */
function Height({ z }: { z: number }) {
  return <AxisValue axis="Z" value={coordinate(z)} />
}

/**
 * Where a 3D probing routine set the work origin, from the contacts it reported, and once it is
 * done the machine X and Y it found, to keep as an anchor.
 */
function probe3dFacts(
  params: OriginParams,
  ball: number,
  { contacts }: ContactsMeasurement,
  status: StageStatus
): {
  description: ReactNode
  facts: Fact[]
  found: readonly [number, number] | null
} {
  const result = originResult(params, ball, contacts)
  const found = status === "done" ? foundPosition(result) : null
  const set = (["X", "Y"] as const).flatMap((axis, index) => {
    const value = result.origin[index]
    return value === null ? [] : [{ axis, value }]
  })
  const facts: Fact[] = []
  if (result.top !== null)
    facts.push({ label: "Top", value: <Height z={result.top} /> })
  const size = result.size.filter((value) => value !== null)
  if (size.length)
    facts.push({
      label: params.routine === "pocket-center" ? "Pocket" : "Boss",
      value: `${size.map(mm).join(" × ")} mm`,
    })
  facts.push({ label: "Contacts", value: String(contacts.length) })
  if (!result.complete || !set.length)
    return { description: probe3dUnfinished(params, status), facts, found }
  const feature = findsCorner(params.routine) ? "corner" : "center"
  return {
    found,
    description: (
      <>
        Found the {feature} and set work{" "}
        {set.map(({ axis }) => (
          <Fragment key={axis}>
            <AxisValue axis={axis} value="0" joined />{" "}
          </Fragment>
        ))}
        there, at machine
        {set.map(({ axis, value }) => (
          <Fragment key={axis}>
            {" "}
            <AxisValue axis={axis} value={coordinate(value)} />
          </Fragment>
        ))}
        {result.top !== null && (
          <>
            {" "}
            and <AxisValue axis="Z" value="0" joined /> on the top it touched
          </>
        )}
        .
      </>
    ),
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

/** What the machine measured in an operation, or what it will do there, and what it sets. */
function operationResults(
  stage: OperationStage,
  subject: JobSubject,
  tools: readonly Tool[],
  settings: OperationSettings | undefined
): { description: ReactNode; details: ReactNode } {
  const { operation, surface, grid, contacts, status } = stage
  const facts: Fact[] = []
  let description: ReactNode = null
  let found: readonly [number, number] | null = null
  const { source } = operation
  // The probe's ball, as the plate's table held it when the job ran.
  const probeId =
    source.kind === "probing"
      ? boundTools(subject.plate, operation).get(source.probe)
      : undefined
  const ball = tools.find((tool) => tool.id === probeId)?.diameter ?? null
  if (
    contacts &&
    source.kind === "probing" &&
    source.task === "origin" &&
    ball !== null
  ) {
    const probed = probe3dFacts(source.params, ball, contacts, status)
    description = probed.description
    facts.push(...probed.facts)
    found = probed.found
  }
  if (surface) {
    const [x, y, z] = surface.machine
    const { work } = surface
    description = (
      <>
        Touched the stock top at machine{" "}
        <AxisValue axis="X" value={coordinate(x)} />{" "}
        <AxisValue axis="Y" value={coordinate(y)} />
        {work && (
          <>
            , work <AxisValue axis="X" value={coordinate(work[0])} />{" "}
            <AxisValue axis="Y" value={coordinate(work[1])} />,
          </>
        )}{" "}
        and set work <AxisValue axis="Z" value="0" joined /> there.
      </>
    )
    facts.push({ label: "Stock top", value: <Height z={z} /> })
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
      value: <Height z={tool.machine[2]} />,
    })
  if (
    !surface &&
    !grid &&
    status === "done" &&
    source.kind === "probing" &&
    (source.task === "touch-off" || source.task === "grid")
  ) {
    // OpenSpindle's own touch-off reports nothing; the machine's cycles report from an anchor.
    const machine = kitForPlate(subject.plate).probing
    const method = machine && methodFor(source, machine, subject.plate)
    description =
      machine && method && !machine.cycles.includes(method)
        ? "The machine does not report this touch's measurement: it touches with G38.2."
        : "The machine reports its measurements only when it probes from a stored anchor with the work origin kept relative to one."
  }
  return {
    description: description ?? operationSummary(operation, subject, tools),
    details: (
      <>
        {settings && <OperationSettingsRow settings={settings} />}
        {facts.length > 0 && <HeightMapFacts facts={facts} />}
        {grid && <HeightMapGrid map={gridMap(grid)} compact />}
        {found && <SaveAsAnchor position={found} plate={subject.plate} />}
      </>
    ),
  }
}

function OperationItem({
  stage,
  subject,
  tools,
  settings,
}: {
  stage: OperationStage
  subject: JobSubject
  tools: readonly Tool[]
  settings: OperationSettings | undefined
}) {
  const { description, details } = operationResults(
    stage,
    subject,
    tools,
    settings
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
  settings,
}: {
  view: Extract<JobView, { kind: "running" }>
  stage: OperationStage | null
  subject: JobSubject | null
  tools: readonly Tool[]
  settings: OperationSettings | undefined
}) {
  const results =
    stage && subject ? operationResults(stage, subject, tools, settings) : null
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
  settings,
  actions,
}: {
  view: JobView
  stage: OperationStage | null
  subject: JobSubject | null
  tools: readonly Tool[]
  settings: OperationSettings | undefined
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
          settings={settings}
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
  const settings = useOperationSettings(subject)
  const readAnchors = useReadAnchorsFix(subject?.plate.id ?? null)
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
  const currentStage = current >= 0 ? operations![current] : null
  const prompt = inOperation ? (
    <CurrentStage
      view={view}
      stage={currentStage}
      subject={subject}
      tools={tools}
      settings={
        currentStage ? settings?.get(currentStage.operation.id) : undefined
      }
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
            readAnchors={readAnchors}
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
              <OperationItem
                stage={stage}
                subject={subject}
                tools={tools}
                settings={settings?.get(stage.operation.id)}
              />
            )}
          </li>
        ))}
      <li>
        <FinishItem view={view} status={stages.finish} />
      </li>
    </ol>
  )
}
