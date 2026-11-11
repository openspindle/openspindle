import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { ReasonButton } from "@/components/workspace/reason-button"
import { AppDialog } from "@/features/shell/app-dialog"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { Plate } from "@/domain/plate/plate"
import { isProbe } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import {
  PROBING_STRATEGIES,
  methodSpecs,
  newProbingOperation,
  strategyById,
} from "@/domain/probing/strategies"
import { withPickedStart } from "@/domain/probing/picked-start"
import { pickTargets } from "@/domain/plate/pick-targets"
import { placementAnchors } from "@/domain/probing/placement"
import { OriginSettings } from "@/features/probing/origin-settings"
import { ProbeSafetyNotice } from "@/features/probing/probe-safety-notice"
import { ProbeTipDiameterField } from "@/features/probing/probe-tip-diameter-field"
import { strategyProbes } from "@/features/probing/probe-tools"
import { openZProbe } from "@/features/device/z-probe-dialog"
import { usePrepareSelection } from "./plate-tree/use-prepare-selection"
import type { ProbingSourceOf } from "@/domain/operations/operation"
import type { StrategyId } from "@/domain/probing/strategy"
import { samePointSetup } from "./point-intent"
import type { PointIntent } from "./point-intent"

export function PointProbeDraft({
  intent,
  onClose,
}: {
  intent: PointIntent
  onClose: () => void
}) {
  const id = useId()
  const plate = useWorkspace((state) =>
    state.plates.find((entry) => entry.id === intent.plateId)
  )
  const library = useWorkspace((state) => state.tools)
  const [routine, setRoutine] = useState("boss-center")
  const [chosen, setChosen] = useState("")
  const strategy = strategyById(routine)
  const machine = plate && kitForPlate(plate).probing
  const probes =
    machine && strategy
      ? strategyProbes(strategy, library.filter(isProbe), machine)
      : []
  const tool =
    probes.find((entry) => entry.tool.id === chosen)?.tool ?? probes.at(0)?.tool
  if (!plate || !samePointSetup(plate.setup, intent.setup))
    return (
      <AppDialog title="Probe at picked point" onClose={onClose}>
        <p>The model setup changed. Right-click the point again.</p>
      </AppDialog>
    )
  return (
    <AppDialog
      title="Probe at picked point"
      onClose={onClose}
      description="Choose and review a probing setup. No motion starts from this menu."
    >
      <FieldGroup>
        <p className="font-numeric">
          Picked model point: X {intent.position[0].toFixed(3)}, Y{" "}
          {intent.position[1].toFixed(3)}, Z {intent.position[2].toFixed(3)} mm.
        </p>
        <Button onClick={() => openZProbe(undefined, intent)}>
          Probe part Z here…
        </Button>
        <FieldDescription>
          The Z guide keeps the measured probe fitted, retracts, moves to this
          XY, then probes down from the raised height to the real surface.
          Review and start the complete sequence in its sidebar.
        </FieldDescription>
        <ProbeSafetyNotice native />
        <Field>
          <FieldLabel htmlFor={`${id}-routine`}>3D probing draft</FieldLabel>
          <OptionSelect
            id={`${id}-routine`}
            value={routine}
            onValueChange={setRoutine}
            options={PROBING_STRATEGIES.filter(
              (entry) => entry.task === "origin"
            ).map((entry) => ({ value: entry.id, label: entry.label }))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-probe`}>Probe</FieldLabel>
          <OptionSelect
            id={`${id}-probe`}
            value={tool?.id ?? ""}
            onValueChange={setChosen}
            options={probes.map(({ tool: entry }) => ({
              value: entry.id,
              label: entry.name,
            }))}
          />
        </Field>
        {tool && <ProbeTipDiameterField tool={tool} />}
        {tool && strategy && machine ? (
          <OriginPointDraft
            key={`${intent.id}:${tool.id}:${tool.diameter}:${routine}`}
            intent={intent}
            plate={plate}
            tool={tool}
            routine={strategy.id}
            onClose={onClose}
          />
        ) : (
          <p>Add a compatible XYZ probe to the tool library.</p>
        )}
      </FieldGroup>
    </AppDialog>
  )
}

function OriginPointDraft({
  intent,
  plate,
  tool,
  routine,
  onClose,
}: {
  intent: PointIntent
  plate: Plate
  tool: Tool
  routine: StrategyId
  onClose: () => void
}) {
  const id = useId()
  const workspace = useWorkspaceStore()
  const selection = usePrepareSelection()
  const machine = kitForPlate(plate).probing!
  const [draft] = useState(() =>
    newProbingOperation(plate, tool, strategyById(routine)!, machine)
  )
  const [source, setSource] = useState<ProbingSourceOf<"origin"> | null>(() => {
    if (
      draft.operation.source.kind !== "probing" ||
      draft.operation.source.task !== "origin"
    )
      return null
    const target = pickTargets(plate.setup, routine).find((entry) =>
      entry.position.every(
        (value, axis) => Math.abs(value - intent.position[axis]) < 0.01
      )
    )
    const picked = withPickedStart(
      draft.operation.source,
      plate,
      intent.position,
      target
    )
    if (picked?.task !== "origin") return null
    const placement = { ...picked.params.placement }
    if (picked.params.routine !== "pocket-center")
      placement.height = intent.position[2] + 5
    else if (target?.kind === "hole")
      placement.height =
        target.position[2] - Math.max(2.5, (tool.diameter ?? 2) + 0.5)
    return { ...picked, params: { ...picked.params, placement } }
  })
  const [valid, setValid] = useState(true)
  const [reviewed, setReviewed] = useState(false)
  const specs = source && methodSpecs(source, machine, plate)
  const probeIssue =
    strategyProbes(strategyById(routine)!, [tool], machine).at(0)?.refused ??
    null
  const add = () => {
    const current = workspace.state.plates.find(
      (entry) => entry.id === plate.id
    )
    if (
      !source ||
      probeIssue ||
      !valid ||
      !reviewed ||
      !current ||
      !samePointSetup(current.setup, intent.setup)
    ) {
      toast.error("Review the current model, probing start and geometry first.")
      return
    }
    const operation = { ...draft.operation, source }
    const number = source.probe
    const result = workspace.dispatch({
      type: "batch",
      commands: [
        {
          type: "operation.add",
          plateId: plate.id,
          operation,
          preferredTools: draft.preferredTools,
        },
        {
          type: "operation.tools",
          plateId: plate.id,
          operationId: operation.id,
          tools: new Map([[number, tool.id]]),
        },
      ],
    })
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    selection.selectOperation(plate.id, operation.id)
    toast.success(
      "Probing draft added. Review it in Prepare before Run; native cycles remain simulator-only."
    )
    onClose()
  }
  if (!source || !specs)
    return (
      <p>Read the plate's anchors before creating a start at this point.</p>
    )
  return (
    <>
      <Alert>
        <AlertDescription>
          Heights and feature geometry come from the model and must be reviewed.
          A boss needs clearance outside both sides. A pocket needs a start
          below its rim with the complete tip clear of its floor. Picked
          surfaces and mesh holes do not establish those clearances
          automatically.
        </AlertDescription>
      </Alert>
      <OriginSettings
        value={source.params}
        parameters={specs}
        anchors={placementAnchors(plate.setup)}
        onChange={(params) => {
          setSource({ ...source, params })
          setReviewed(false)
        }}
        onValidityChange={setValid}
      />
      <Field orientation="horizontal">
        <Checkbox
          id={`${id}-review`}
          checked={reviewed}
          onCheckedChange={(checked) => setReviewed(checked === true)}
        />
        <FieldLabel htmlFor={`${id}-review`}>
          I have reviewed the start height, feature size, probe diameter and
          clearances in this draft.
        </FieldLabel>
      </Field>
      <ReasonButton
        label="Add probing draft"
        reason={
          probeIssue ??
          (!valid || !reviewed
            ? "Review the probing geometry and correct any invalid fields."
            : null)
        }
        onClick={add}
      >
        Add probing draft
      </ReasonButton>
    </>
  )
}
