import { useId, useMemo } from "react"
import { FileCode2, Puzzle, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { templateProgram } from "@/app/workspace/templates"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { placementAnchors } from "@/domain/probing/placement"
import { strategyFor, strategyReads } from "@/domain/probing/strategies"
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
import { localTools } from "@/domain/tools/tool-table"
import { GridSettings } from "@/features/probing/grid-settings"
import { OutlineSettings } from "@/features/probing/outline-settings"
import { TouchOffSettings } from "@/features/probing/touch-off-settings"
import { useFusionUpdate } from "@/features/fusion360/use-fusion-update"
import { OriginSettings } from "@/features/probing/origin-settings"
import type { WorkAreaFit } from "@/features/probing/probing-form"
import { PluginFrame } from "@/features/plugins/plugin-frame"
import { TemplateForm } from "@/features/plugins/template-form"
import { useTemplateUpdate } from "@/features/plugins/use-template-update"
import { openDialog } from "@/features/shell/dialogs"
import { anchorDisplayName, bedAnchors } from "@/domain/anchors/stored-anchors"
import { isPluginUsable } from "@/platform/contract/plugin-rpc"
import type { PluginSummary } from "@/platform/contract/plugin-rpc"
import { useInstalledPlugins } from "@/platform/plugins"
import { usePrepareSelection } from "../plate-tree/use-prepare-selection"
import { ProbingChoiceFields } from "./probing-choice-fields"

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

/** What the editor says of the plugin, beside the version that generated the operation. */
function templateNote(plugin: PluginSummary, version: string): string | null {
  if (plugin.incompatible) return plugin.incompatible
  if (plugin.version !== version)
    return `version ${plugin.version} is installed; apply to update.`
  return null
}

function TemplateEditor({ plate, operation }: EditorProps<"template">) {
  const { pluginId, programId, values, version } = operation.source
  const plugins = useInstalledPlugins().data
  const update = useTemplateUpdate()
  if (!plugins) return null
  const plugin = plugins.find((item) => item.id === pluginId)
  const program = plugin ? templateProgram(plugin, programId) : undefined
  if (!plugin || !program)
    return (
      <FieldDescription>
        {pluginId} is not installed, so this program cannot be edited. Its NC is
        kept and still runs.
      </FieldDescription>
    )
  const note = templateNote(plugin, version)
  return (
    <div className="flex flex-col gap-3">
      <FieldDescription>
        {plugin.manifest.name} {version}
        {note && ` · ${note}`}
      </FieldDescription>
      <TemplateForm
        // Reset only when the saved values change (Apply, an update, undo): a rename or
        // Pause before also revises the operation and must not discard unapplied edits.
        key={JSON.stringify([programId, version, values])}
        program={program}
        values={values}
        submitLabel="Apply"
        disabled={!isPluginUsable(plugin)}
        onSubmit={(next) =>
          // The mutation reports failures itself.
          update
            .mutateAsync({ plateId: plate.id, operation, plugin, values: next })
            .catch(() => undefined)
        }
      />
    </div>
  )
}

/** Why a plugin operation's editor cannot open. */
function unavailableEditor(
  pluginId: string,
  plugin: PluginSummary | undefined
): string {
  if (!plugin)
    return `${pluginId} is not installed. The operation keeps its data and NC; install the plugin to edit it.`
  if (plugin.incompatible)
    return `${plugin.manifest.name} cannot run: ${plugin.incompatible} The operation keeps its data and NC.`
  if (!plugin.enabled)
    return `${plugin.manifest.name} is disabled. Enable it to edit this operation.`
  return `${plugin.manifest.name} has no editor for its operations.`
}

/** A plugin operation is edited in its plugin's own editor view. */
function PluginEditor({ plate, operation }: EditorProps<"plugin">) {
  const { pluginId } = operation.source
  const plugins = useInstalledPlugins().data
  const selection = usePrepareSelection()
  if (!plugins) return null
  const plugin = plugins.find((item) => item.id === pluginId)
  const editor = plugin?.manifest.ui?.views.find(
    (view) => view.slot === "operation.editor"
  )
  if (!plugin || !isPluginUsable(plugin) || !editor)
    return (
      <div className="flex flex-col gap-3">
        <FieldDescription>
          {unavailableEditor(pluginId, plugin)}
        </FieldDescription>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => openDialog({ kind: "plugins" })}
        >
          <Puzzle />
          Manage plugins
        </Button>
      </div>
    )
  return (
    <PluginFrame
      plugin={plugin}
      viewId={editor.id}
      plateId={plate.id}
      operationId={operation.id}
      onClose={(select) => {
        if (select)
          selection.selectOperation(select.plateId, select.operationId)
        else selection.selectPlate(plate.id)
      }}
    />
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

/** A probing task's settings editor: its operation, on a machine that has its strategy. */
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
  const workArea = useWorkArea(plate)
  const { source } = operation
  const strategy = strategyFor(source, machine)
  if (!strategy) return null
  return (
    <GridSettings
      key={operation.id}
      value={source.params}
      parameters={strategy.parameters(machine)}
      anchors={anchorOptions(plate)}
      workArea={workArea}
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
  const workArea = useWorkArea(plate)
  const { source } = operation
  const strategy = strategyFor(source, machine)
  if (!strategy) return null
  return (
    <TouchOffSettings
      key={operation.id}
      value={source.params}
      parameters={strategy.parameters(machine)}
      reads={strategyReads(strategy, source.params, machine)}
      anchors={anchorOptions(plate)}
      workArea={workArea}
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
  const { source } = operation
  const strategy = strategyFor(source, machine)
  if (!strategy) return null
  return (
    <OutlineSettings
      key={operation.id}
      value={source.params}
      parameters={strategy.parameters(machine)}
      outline={outline}
      onChange={(params) => update({ ...source, params })}
    />
  )
}

/** An origin task's settings: the routine, and where it starts. */
function OriginEditor({
  plate,
  operation,
  machine,
}: TaskEditorProps<ProbingSourceOf<"origin">>) {
  const update = useSourceUpdate(plate, operation.id, operation.revision)
  const { source } = operation
  const strategy = strategyFor(source, machine)
  if (!strategy) return null
  return (
    <OriginSettings
      key={operation.id}
      value={source.params}
      parameters={strategy.parameters(machine)}
      anchors={anchorOptions(plate)}
      onChange={(params) => update({ ...source, params })}
    />
  )
}

/**
 * A probing operation's probe and strategy, then its task's settings. Without the strategy on the
 * plate's machine it has no settings; its diagnostic above says why.
 */
function ProbingEditor({ plate, operation }: EditorProps<"probing">) {
  const machine = kitForPlate(plate).probing
  const strategy = machine && strategyFor(operation.source, machine)
  if (!machine || !strategy) return null
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
    case "file":
      return <FileEditor plate={plate} operation={{ ...operation, source }} />
    case "template":
      return (
        <TemplateEditor plate={plate} operation={{ ...operation, source }} />
      )
    case "plugin":
      return <PluginEditor plate={plate} operation={{ ...operation, source }} />
    case "probing":
      return (
        <ProbingEditor plate={plate} operation={{ ...operation, source }} />
      )
  }
}
