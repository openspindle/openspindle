import { useId, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { targetPlate } from "@/app/workspace/defaults"
import {
  selectedPlate,
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { plateWorkArea } from "@/domain/compile/toolpath-bounds"
import type { Plate } from "@/domain/plate/plate"
import type { Operation } from "@/domain/operations/operation"
import type { Tool } from "@/domain/tools/tool"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import {
  INSPECTION_RECIPES,
  inspectionOperations,
  inspectionOperationProblem,
  inspectionPlate,
  repeatInspection,
  RepeatCountSchema,
} from "@/domain/probing/inspection-recipes"
import type { InspectionRecipe } from "@/domain/probing/inspection-recipes"
import { placementAnchors } from "@/domain/probing/placement"
import {
  methodSpecs,
  strategyById,
  strategyBlocked,
  strategyUnsupported,
} from "@/domain/probing/strategies"
import type { MachineProbing } from "@/domain/probing/strategy"
import { AppDialog } from "@/features/shell/app-dialog"
import { useImportContext } from "@/features/shell/use-import"
import { usePrepareSelection } from "@/features/prepare/plate-tree/use-prepare-selection"
import { defaultProbe, strategyProbes } from "./probe-tools"
import { OriginSettings } from "./origin-settings"
import { GridSettings } from "./grid-settings"
import { ParameterField, probingField } from "./probing-fields"
import { useProbingForm } from "./probing-form"
import { z } from "zod"
import { ProbeSafetyNotice } from "./probe-safety-notice"
import { ProbeTipDiameterField } from "./probe-tip-diameter-field"

export function InspectionWizard({
  recipe,
  onClose,
}: {
  recipe: InspectionRecipe
  onClose: () => void
}) {
  const selected = useWorkspace(selectedPlate)
  const context = useImportContext()
  const library = useWorkspace((state) => state.tools)
  const [plate] = useState(() =>
    inspectionPlate(targetPlate(selected, context(), false), recipe)
  )
  const [chosen, setChosen] = useState("")
  const definition = INSPECTION_RECIPES.find((item) => item.id === recipe)!
  const strategy = strategyById(definition.strategy)!
  const machine = kitForPlate(plate).probing
  let problem = "This machine has no probing."
  if (machine)
    problem =
      strategyUnsupported(strategy, machine) ??
      strategyBlocked(strategy, plate, machine) ??
      ""
  const probes = machine ? strategyProbes(strategy, library, machine) : []
  const tool =
    probes.find((item) => item.tool.id === chosen)?.tool ??
    (machine &&
      defaultProbe(
        strategy,
        plate,
        probes.map((item) => item.tool),
        machine
      )) ??
    probes.at(0)?.tool
  if (!placementAnchors(plate.setup).length)
    problem =
      "Read or restore stored anchors for this device before creating an inspection plate."
  if (!tool && !problem) problem = "The tool library has no compatible probe."
  if (!machine || !tool || problem)
    return (
      <AppDialog title={definition.label} onClose={onClose}>
        <Alert>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      </AppDialog>
    )
  return (
    <InspectionDraft
      key={`${tool.id}:${tool.diameter}`}
      plate={plate}
      recipe={recipe}
      tool={tool}
      machine={machine}
      probes={probes.map((item) => item.tool)}
      onProbe={setChosen}
      onClose={onClose}
    />
  )
}

function InspectionDraft({
  plate,
  recipe,
  tool,
  machine,
  probes,
  onProbe,
  onClose,
}: {
  plate: Plate
  recipe: InspectionRecipe
  tool: Tool
  machine: MachineProbing
  probes: Tool[]
  onProbe: (id: string) => void
  onClose: () => void
}) {
  const id = useId()
  const workspace = useWorkspaceStore()
  const selection = usePrepareSelection()
  const [operations, setOperations] = useState(() =>
    inspectionOperations(plate, recipe, tool, machine)
  )
  const [validity, setValidity] = useState<Record<string, boolean>>({})
  const [repeats, setRepeats] = useState(3)
  const [countValid, setCountValid] = useState(true)
  const count = useProbingForm(
    { repeats },
    z.object({ repeats: RepeatCountSchema }),
    (value) => setRepeats(value.repeats),
    setCountValid
  )
  const anchors = placementAnchors(plate.setup)
  const options = anchors.map(({ id: anchorId, name }) => ({
    id: anchorId,
    name,
  }))
  const strategy = strategyById(
    INSPECTION_RECIPES.find((entry) => entry.id === recipe)!.strategy
  )!
  const problem =
    strategyProbes(strategy, [tool], machine).at(0)?.refused ??
    operations
      .map(({ source }) =>
        source.kind === "probing"
          ? inspectionOperationProblem(source, plate, machine)
          : "Invalid inspection source."
      )
      .find(Boolean)
  const invalid =
    Object.values(validity).some((valid) => !valid) ||
    (recipe === "repeatability" && !countValid)
  const create = useMutation({
    mutationFn: async () => {
      if (invalid || problem)
        throw new Error(problem ?? "Correct the highlighted fields.")
      const liveTool = workspace.state.tools.find((item) => item.id === tool.id)
      if (
        !liveTool ||
        !strategyProbes(strategy, [liveTool], machine).some(
          (item) => item.refused === null
        )
      )
        throw new Error(
          "The selected probe is no longer available or compatible."
        )
      const added =
        recipe === "repeatability"
          ? repeatInspection(operations[0], repeats)
          : operations
      const commands: WorkspaceCommand[] = [
        { type: "plates.add", plates: [plate], select: true },
      ]
      for (const operation of added) {
        if (operation.source.kind !== "probing")
          throw new Error("Invalid probing source.")
        commands.push({
          type: "operation.add",
          plateId: plate.id,
          operation,
          preferredTools: new Map([[operation.source.probe, liveTool.id]]),
        })
      }
      const result = workspace.dispatch({ type: "batch", commands })
      if (!result.ok) throw new Error(result.error)
      selection.selectOperation(plate.id, added[0].id)
    },
    onSuccess: () => {
      toast.success(
        "Inspection plate created. Review it in Prepare, then Run from Job."
      )
      onClose()
    },
    onError: (error) => toast.error(error.message),
  })
  const update = (operationId: string, source: Operation["source"]) =>
    setOperations((current) =>
      current.map((item) =>
        item.id === operationId ? { ...item, source } : item
      )
    )
  return (
    <AppDialog
      title={plate.name}
      description="Creates a separate probing plate. Origin routines change work zero; surface grids enable compensation. Simulator geometry is synthetic."
      width="wide"
      onClose={onClose}
      footer={
        <Button
          disabled={invalid || !!problem || create.isPending}
          onClick={() => create.mutate()}
        >
          Create inspection plate
        </Button>
      }
    >
      <FieldGroup>
        <ProbeSafetyNotice native />
        <Field>
          <FieldLabel htmlFor={`${id}-probe`}>Probe</FieldLabel>
          <OptionSelect
            id={`${id}-probe`}
            value={tool.id}
            options={probes.map((probe) => ({
              value: probe.id,
              label: probe.name,
            }))}
            onValueChange={onProbe}
          />
        </Field>
        <ProbeTipDiameterField tool={tool} disabled={create.isPending} />
        {recipe === "repeatability" && (
          <ParameterField
            id={`${id}-repeats`}
            parameter={{
              label: "Measurements",
              min: 2,
              max: 10,
              step: 1,
              integer: true,
              default: 3,
            }}
            field={probingField(count, "repeats")}
            disabled={create.isPending}
          />
        )}
        {operations.map((operation) => {
          const source = operation.source
          if (source.kind !== "probing") return null
          const onValidityChange = (valid: boolean) =>
            setValidity((current) => ({ ...current, [operation.id]: valid }))
          if (source.task === "origin") {
            const specs = methodSpecs(source, machine, plate)
            if (!specs) return null
            return (
              <FieldSet key={operation.id}>
                <FieldLegend>{operation.name}</FieldLegend>
                <OriginSettings
                  value={source.params}
                  parameters={specs}
                  anchors={options}
                  onValidityChange={onValidityChange}
                  onChange={(params) =>
                    update(operation.id, { ...source, params })
                  }
                  disabled={create.isPending}
                />
              </FieldSet>
            )
          }
          if (source.task === "grid") {
            const specs = methodSpecs(source, machine, plate)
            if (!specs) return null
            return (
              <GridSettings
                key={operation.id}
                value={source.params}
                parameters={specs}
                anchors={options}
                workArea={{
                  result: plateWorkArea(plate),
                  origin: [
                    plate.setup.workOrigin[0],
                    plate.setup.workOrigin[1],
                  ],
                  anchors,
                }}
                onValidityChange={onValidityChange}
                onChange={(params) =>
                  update(operation.id, { ...source, params })
                }
                disabled={create.isPending}
              />
            )
          }
          return null
        })}
        {problem && (
          <Alert>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
      </FieldGroup>
    </AppDialog>
  )
}
