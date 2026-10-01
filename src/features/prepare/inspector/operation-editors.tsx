import { useId, useMemo } from "react"
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
import { placementAnchors } from "@/domain/auto-level/fit"
import { kitForPlate } from "@/domain/fixtures/catalog"
import { closingParkCodes } from "@/domain/compile/nc-unit"
import {
  plateToolpathBounds,
  plateWorkArea,
} from "@/domain/compile/toolpath-bounds"
import type { OperationOf } from "@/domain/operations/kinds"
import type { NcOrigin, OperationSource } from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import { localTools } from "@/domain/tools/tool-table"
import { AutoLevelSettings } from "@/features/auto-level/auto-level-settings"
import { AutoScanSettings } from "@/features/auto-scan/auto-scan-settings"
import { AutoZHeightSettings } from "@/features/auto-z-height/auto-z-height-settings"
import { useFusionUpdate } from "@/features/fusion360/use-fusion-update"
import { EditorView } from "@/features/pcb/editor"
import { Probe3dSettings } from "@/features/probe-3d/probe-3d-settings"
import type { WorkAreaFit } from "@/features/probing/probing-form"
import { openDialog } from "@/features/shell/dialogs"
import { anchorDisplayName, bedAnchors } from "@/domain/anchors/stored-anchors"

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

function AutoLevelEditor({ plate, operation }: EditorProps<"auto-level">) {
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const workArea = useWorkArea(plate)
  const probe = kitForPlate(plate).probe
  // Without a probe the operation has no settings; its diagnostic above says why.
  if (!probe) return null
  return (
    <AutoLevelSettings
      key={operation.id}
      value={operation.source.params}
      parameters={probe.autoLevel.parameters}
      anchors={anchorOptions(plate)}
      workArea={workArea}
      onChange={(params) => update({ kind: "auto-level", params })}
    />
  )
}

function AutoZHeightEditor({ plate, operation }: EditorProps<"auto-z-height">) {
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const workArea = useWorkArea(plate)
  const probe = kitForPlate(plate).probe
  // Without a probe the operation has no settings; its diagnostic above says why.
  if (!probe) return null
  return (
    <AutoZHeightSettings
      key={operation.id}
      value={operation.source.params}
      parameters={probe.autoZHeight.parameters}
      anchors={anchorOptions(plate)}
      workArea={workArea}
      onChange={(params) => update({ kind: "auto-z-height", params })}
    />
  )
}

function AutoScanEditor({ plate, operation }: EditorProps<"auto-scan">) {
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const outline = useMemo(() => plateToolpathBounds(plate), [plate])
  const trace = kitForPlate(plate).probe?.autoScan
  // Without a pointer the operation has no settings; its diagnostic above says why.
  if (!trace) return null
  return (
    <AutoScanSettings
      key={operation.id}
      value={operation.source.params}
      parameters={trace.parameters}
      outline={outline}
      onChange={(params) => update({ kind: "auto-scan", params })}
    />
  )
}

/** 3D probing's settings: the routine, and where it starts. */
function Probe3dEditor({ plate, operation }: EditorProps<"probe-3d">) {
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const probing = kitForPlate(plate).probe?.probe3d
  // Without a 3D probe the operation has no settings; its diagnostic above says why.
  if (!probing) return null
  return (
    <Probe3dSettings
      key={operation.id}
      value={operation.source.params}
      parameters={probing.parameters}
      anchors={anchorOptions(plate)}
      onChange={(params) => update({ kind: "probe-3d", params })}
    />
  )
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
    case "auto-level":
      return (
        <AutoLevelEditor plate={plate} operation={{ ...operation, source }} />
      )
    case "auto-z-height":
      return (
        <AutoZHeightEditor plate={plate} operation={{ ...operation, source }} />
      )
    case "auto-scan":
      return (
        <AutoScanEditor plate={plate} operation={{ ...operation, source }} />
      )
    case "probe-3d":
      return (
        <Probe3dEditor plate={plate} operation={{ ...operation, source }} />
      )
  }
}
