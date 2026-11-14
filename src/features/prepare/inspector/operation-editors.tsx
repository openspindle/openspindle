import { useEffect, useId, useMemo } from "react"
import { FileCode2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { placementAnchors } from "@/domain/probing/placement"
import {
  methodFor,
  methodReads,
  methodSpecs,
  strategyById,
} from "@/domain/probing/strategies"
import type { MachineProbing } from "@/domain/probing/strategy"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { closingParkCodes } from "@/domain/compile/nc-unit"
import {
  plateToolpathBounds,
  plateWorkArea,
} from "@/domain/compile/toolpath-bounds"
import type { OperationOf, ProbingOperation } from "@/domain/operations/kinds"
import type {
  NcOrigin,
  OperationSource,
  ProbingSourceOf,
} from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import { itemEdges } from "@/domain/plate/item-edges"
import { localTools } from "@/domain/tools/tool-table"
import { GridSettings } from "@/features/probing/grid-settings"
import { OutlineSettings } from "@/features/probing/outline-settings"
import { TouchOffSettings } from "@/features/probing/touch-off-settings"
import { useFusionUpdate } from "@/features/fusion360/use-fusion-update"
import { EditorView } from "@/features/pcb/editor"
import { OriginSettings } from "@/features/probing/origin-settings"
import type { WorkAreaFit } from "@/features/probing/probing-form"
import { openDialog } from "@/features/shell/dialogs"
import { anchorDisplayName, bedAnchors } from "@/domain/anchors/stored-anchors"
import { ProbingChoiceFields } from "./probing-choice-fields"
import type { ProbingPick } from "@/features/probing/probing-fields"
import {
  currentPicking,
  setPicking,
  usePicking,
} from "../arrange/arrange-state"

type EditorProps<TKind extends OperationSource["kind"]> = {
  plate: Plate
  operation: OperationOf<TKind>
}

/** Replaces an operation's source, refusing if it changed since it was shown. */
function useSourceUpdate(plate: Plate, operationId: string, revision: number) {
  const workspace = useWorkspaceStore()
  return (source: OperationSource) => {
    const result = workspace.dispatch({
      type: "operation.source",
      plateId: plate.id,
      operationId,
      source,
      expectedRevision: revision,
    })
    if (!result.ok) toast.error(result.error)
  }
}

/** Where a Fusion 360 operation came from: "Bracket v3 › NCProgram1 › Face1". */
const originText = ({ documentName, programName, part }: NcOrigin) =>
  [documentName, programName, part?.name]
    .filter((name) => name !== undefined)
    .join(" › ")

/** Posts the operation's Fusion 360 NC program again and updates the operation from it. */
function UpdateFromFusion({
  plate,
  operationId,
}: {
  plate: Plate
  operationId: string
}) {
  const update = useFusionUpdate()
  return (
    <Button
      variant="outline"
      disabled={update.isPending}
      onClick={() => update.mutate({ plateId: plate.id, operationId })}
    >
      <RefreshCw />
      {update.isPending ? "Updating…" : "Update from Fusion 360"}
    </Button>
  )
}

function FileEditor({ plate, operation }: EditorProps<"file">) {
  const { nc, park, origin } = operation.source
  const id = useId()
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const lines = useMemo(() => nc.split(/\r\n?|\n/).length, [nc])
  const tools = useMemo(
    () => localTools(nc).filter((tool) => tool !== null).length,
    [nc]
  )
  // A program that ends with the park of the plate's machine gets the switch, which names it.
  const kit = kitForPlate(plate)
  const parkCodes = useMemo(() => closingParkCodes(nc, kit), [nc, kit])
  return (
    <>
      <div className="flex flex-col gap-3">
        <FieldDescription className="font-numeric">
          {lines} lines · {tools} tools
        </FieldDescription>
        {origin && (
          <FieldDescription>
            From Fusion 360: {originText(origin)}
          </FieldDescription>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              openDialog({
                kind: "source",
                plateId: plate.id,
                operationId: operation.id,
              })
            }
          >
            <FileCode2 />
            View source
          </Button>
          {origin && (
            <UpdateFromFusion plate={plate} operationId={operation.id} />
          )}
        </div>
      </div>
      {parkCodes !== null && (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`${id}-park`}>Park after machining</FieldLabel>
            <FieldDescription>
              Move to the machine's clearance position at the end, with the
              program's own {parkCodes}.
            </FieldDescription>
          </FieldContent>
          <Switch
            id={`${id}-park`}
            checked={park}
            onCheckedChange={(value) =>
              update({ ...operation.source, park: value })
            }
          />
        </Field>
      )}
    </>
  )
}

/** The plate device's stored anchors a probing operation can be placed from. */
function anchorOptions(plate: Plate) {
  const setup = plate.setup.anchors
  const factory = setup?.source === "factory"
  return bedAnchors(setup ?? undefined).map((anchor) => ({
    id: anchor.id,
    name: anchorDisplayName(anchor, factory),
  }))
}

/** Where the plate cuts, which the probing operations can be fitted to. */
function useWorkArea(plate: Plate): WorkAreaFit {
  return useMemo(
    () => ({
      result: plateWorkArea(plate),
      origin: [plate.setup.workOrigin[0], plate.setup.workOrigin[1]],
      anchors: placementAnchors(plate.setup),
    }),
    [plate]
  )
}

/**
 * Picking for an operation in the 3D view: a point to start it at, or edges for it to trace.
 * Picking ends when its editor goes, such as when another operation is selected. A start is
 * kept from an anchor, so a plate without anchors cannot pick one.
 */
function usePick(
  plate: Plate,
  operationId: string,
  kind: "point" | "edges"
): ProbingPick {
  const picking = usePicking()
  useEffect(
    () => () => {
      if (currentPicking()?.operationId === operationId) setPicking(null)
    },
    [operationId]
  )
  const active = picking?.operationId === operationId && picking.kind === kind
  const reason =
    kind === "point" && !placementAnchors(plate.setup).length
      ? "Read the device's anchors: a picked start is kept from one."
      : null
  return {
    picking: active,
    reason,
    onPick: () =>
      setPicking(active ? null : { kind, plateId: plate.id, operationId }),
  }
}

/** A probing task's settings editor: its operation, on a machine that supports its strategy. */
type TaskEditorProps<TSource> = {
  plate: Plate
  operation: ProbingOperation & { source: TSource }
  machine: MachineProbing
}

function GridEditor({
  plate,
  operation,
  machine,
}: TaskEditorProps<ProbingSourceOf<"grid">>) {
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const pick = usePick(plate, operation.id, "point")
  const workArea = useWorkArea(plate)
  const { source } = operation
  const parameters = methodSpecs(source, machine, plate)
  if (!parameters) return null
  return (
    <GridSettings
      key={operation.id}
      value={source.params}
      parameters={parameters}
      anchors={anchorOptions(plate)}
      workArea={workArea}
      pick={pick}
      onChange={(params) => update({ ...source, params })}
    />
  )
}

function TouchOffEditor({
  plate,
  operation,
  machine,
}: TaskEditorProps<ProbingSourceOf<"touch-off">>) {
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const pick = usePick(plate, operation.id, "point")
  const workArea = useWorkArea(plate)
  const { source } = operation
  // The method follows the settings: an anchored start can let the machine's own cycle touch off.
  const method = methodFor(source, machine, plate)
  if (!method) return null
  return (
    <TouchOffSettings
      key={operation.id}
      value={source.params}
      parameters={method.parameters(machine)}
      reads={methodReads(method, source.params, machine)}
      anchors={anchorOptions(plate)}
      workArea={workArea}
      pick={pick}
      onChange={(params) => update({ ...source, params })}
    />
  )
}

function OutlineEditor({
  plate,
  operation,
  machine,
}: TaskEditorProps<ProbingSourceOf<"outline">>) {
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const outline = useMemo(() => plateToolpathBounds(plate), [plate])
  const edges = useMemo(() => itemEdges(plate.setup), [plate.setup])
  const pick = usePick(plate, operation.id, "edges")
  const { source } = operation
  const parameters = methodSpecs(source, machine, plate)
  if (!parameters) return null
  return (
    <OutlineSettings
      key={operation.id}
      value={source.params}
      parameters={parameters}
      outline={outline}
      edges={edges}
      hasStock={!!plate.setup.stock}
      pick={pick}
      onChange={(params) => update({ ...source, params })}
    />
  )
}

/** An origin task's settings: what its strategy finds, and where it starts. */
function OriginEditor({
  plate,
  operation,
  machine,
}: TaskEditorProps<ProbingSourceOf<"origin">>) {
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const pick = usePick(plate, operation.id, "point")
  const { source } = operation
  const parameters = methodSpecs(source, machine, plate)
  if (!parameters) return null
  return (
    <OriginSettings
      key={operation.id}
      value={source.params}
      parameters={parameters}
      anchors={anchorOptions(plate)}
      pick={pick}
      onChange={(params) => update({ ...source, params })}
    />
  )
}

/**
 * A probing operation's strategy and probe, then its task's settings. Without a method for its
 * strategy on the plate's machine it has no settings; its diagnostic above says why.
 */
function ProbingEditor({ plate, operation }: EditorProps<"probing">) {
  const machine = kitForPlate(plate).probing
  const strategy = strategyById(operation.source.strategy)
  if (!machine || !strategy || !methodFor(operation.source, machine, plate))
    return null
  return (
    <>
      <ProbingChoiceFields
        plate={plate}
        operation={operation}
        machine={machine}
        strategy={strategy}
      />
      <TaskEditor plate={plate} operation={operation} machine={machine} />
    </>
  )
}

/** The settings of a probing operation's task. */
function TaskEditor({
  plate,
  operation,
  machine,
}: TaskEditorProps<ProbingOperation["source"]>) {
  const { source } = operation
  switch (source.task) {
    case "grid":
      return (
        <GridEditor
          plate={plate}
          operation={{ ...operation, source }}
          machine={machine}
        />
      )
    case "touch-off":
      return (
        <TouchOffEditor
          plate={plate}
          operation={{ ...operation, source }}
          machine={machine}
        />
      )
    case "outline":
      return (
        <OutlineEditor
          plate={plate}
          operation={{ ...operation, source }}
          machine={machine}
        />
      )
    case "origin":
      return (
        <OriginEditor
          plate={plate}
          operation={{ ...operation, source }}
          machine={machine}
        />
      )
  }
}

/** The editor for an operation's source, by kind. */
export function OperationEditor({
  plate,
  operation,
}: {
  plate: Plate
  operation: OperationOf<OperationSource["kind"]>
}) {
  const source = operation.source
  switch (source.kind) {
    case "facing":
      return (
        <Button
          variant="outline"
          onClick={() =>
            openDialog({
              kind: "facing",
              plateId: plate.id,
              operationId: operation.id,
            })
          }
        >
          Edit facing and cutting data
        </Button>
      )
    case "file":
      return <FileEditor plate={plate} operation={{ ...operation, source }} />
    case "pcb":
      return <EditorView plateId={plate.id} operationId={operation.id} />
    case "unsupported":
      return (
        <FieldDescription>
          This operation has no generated program. Replace it with a supported
          operation before running.
        </FieldDescription>
      )
    case "probing":
      return (
        <ProbingEditor plate={plate} operation={{ ...operation, source }} />
      )
  }
}
