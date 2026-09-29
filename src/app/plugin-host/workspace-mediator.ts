import { RpcError } from "@openspindle/rpc"
import type { ParamsOut } from "@openspindle/rpc"
import { canonicalJson } from "@openspindle/plugin-core"
import type {
  PluginIdentity,
  PluginViewContract,
  Tool as PluginTool,
  WorkspaceSummary,
} from "@openspindle/plugin-core"
import type { Tool } from "@/domain/tools/tool"
import type { OperationOf } from "@/domain/operations/kinds"
import { OperationSchema, createOperation } from "@/domain/operations/operation"
import type { Operation } from "@/domain/operations/operation"
import { plateLabel } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import { localTools } from "@/domain/tools/tool-table"
import type {
  WorkspaceCommand,
  WorkspaceState,
} from "@/domain/workspace/workspace"
import { replacementPlate } from "../workspace/defaults"
import {
  describeProblems,
  readOperations,
  readPlates,
} from "../workspace/import-files"
import type { ImportContext } from "../workspace/import-program"
import type { WorkspaceStore } from "../workspace/store"
import { selectedPlate } from "../workspace/workspace-context"
import type {
  OperationDraftRecord,
  OperationRecord,
  WorkspaceMediator,
} from "./broker"

type Params<TMethod extends keyof PluginViewContract["methods"]> = ParamsOut<
  PluginViewContract,
  TMethod
>

/** A library tool and the preset to apply, as the user chose them. */
export type ChosenTool = {
  readonly toolId: string
  readonly presetId: string | null
}

/** The app's own dialogs and notices for plugin requests; dialogs close when `signal` aborts. */
export interface PluginDialogs {
  /** Resolves with the choice, or null when the user cancels. */
  chooseTool: (
    plugin: PluginIdentity,
    request: Params<"tools.choose">,
    signal: AbortSignal
  ) => Promise<ChosenTool | null>
  confirm: (
    plugin: PluginIdentity,
    request: Params<"ui.confirm">,
    signal: AbortSignal
  ) => Promise<boolean>
  notify: (plugin: PluginIdentity, notice: Params<"ui.notify">) => void
  progress: (plugin: PluginIdentity, progress: Params<"ui.progress">) => void
}

export type WorkspaceMediatorOptions = {
  readonly workspace: WorkspaceStore
  /** The installed, enabled plugin; operations record the version that wrote them. */
  readonly plugin: (
    pluginId: string
  ) => { readonly name: string; readonly version: string } | null
  /** What new plates and imported programs start from. */
  readonly importContext: () => ImportContext
  readonly dialogs: PluginDialogs
  /** Operations a plugin just created, for example to select them. */
  readonly onCreated?: (plateId: string, operationIds: string[]) => void
}

type PluginOperation = OperationOf<"plugin">

const isOwn = (
  operation: Operation,
  pluginId: string
): operation is PluginOperation =>
  operation.source.kind === "plugin" && operation.source.pluginId === pluginId

/** NC tool slots of the plugin contract: `default` is the tool of a program that selects none. */
const slotOf = (local: number | null) =>
  local === null ? "default" : String(local)
const localOf = (slot: string): number | null =>
  slot === "default" ? null : Number(slot)

/** Which library tool each of the operation's own tool numbers runs with. */
function toolAssignments(
  plate: Plate,
  operation: Operation
): Record<string, string> {
  const assignments: Record<string, string> = {}
  for (const binding of operation.tools) {
    const toolId = plate.tools.find(
      (tool) => tool.number === binding.plate
    )?.toolId
    if (toolId) assignments[slotOf(binding.local)] = toolId
  }
  return assignments
}

function toRecord(plate: Plate, operation: PluginOperation): OperationRecord {
  return {
    id: operation.id,
    plateId: plate.id,
    name: operation.name,
    stopBefore: operation.stopBefore,
    toolAssignments: toolAssignments(plate, operation),
    data: operation.source.data,
    nc: operation.source.nc,
  }
}

/**
 * The library tools a plugin assigned, by the operation's own tool numbers. `default` is the
 * program's implicit tool, and also stands for numbers the NC selects without their own slot.
 */
function assignedTools(
  assignments: Readonly<Record<string, string>>,
  nc: string | null
): Map<number | null, string> {
  const tools = new Map<number | null, string>()
  for (const [slot, toolId] of Object.entries(assignments))
    tools.set(localOf(slot), toolId)
  if (Object.hasOwn(assignments, "default") && nc !== null)
    for (const local of localTools(nc))
      if (!tools.has(local)) tools.set(local, assignments.default)
  return tools
}

/** New assignments must name library tools; unchanged ones may dangle, as the user left them. */
function checkTools(
  assignments: Readonly<Record<string, string>>,
  library: readonly Tool[],
  current: Readonly<Record<string, string>> = {}
) {
  for (const [slot, toolId] of Object.entries(assignments))
    if (
      !(Object.hasOwn(current, slot) && current[slot] === toolId) &&
      !library.some((tool) => tool.id === toolId)
    )
      throw new RpcError(
        "INVALID_PARAMS",
        "An assigned tool is not in the tool library. Choose it again."
      )
}

/** Stored plates must load again: what a plugin writes meets the operation schema. */
function checkOperation(operation: Operation) {
  const checked = OperationSchema.safeParse(operation)
  if (!checked.success)
    throw new RpcError(
      "INVALID_PARAMS",
      checked.error.issues.at(0)?.message ?? "The operation is invalid."
    )
}

/**
 * A library tool as plugins see it: everything but its photo, holder, other post-processor
 * settings and import source.
 */
export function pluginTool(tool: Tool): PluginTool {
  return {
    id: tool.id,
    name: tool.name,
    kind: tool.kind,
    diameter: tool.diameter,
    flutes: tool.flutes,
    vendor: tool.vendor,
    productId: tool.productId,
    productLink: tool.productLink,
    vendorDescription: tool.vendorDescription,
    material: tool.material,
    grade: tool.grade,
    coating: tool.coating,
    notes: tool.notes,
    number: tool.postProcess.number,
    geometry: { ...tool.geometry },
    shaft: {
      segments: tool.shaft.segments.map((segment) => ({ ...segment })),
    },
    presets: tool.presets.map((preset) => ({ ...preset })),
  }
}

function summarize(state: WorkspaceState): Omit<WorkspaceSummary, "revision"> {
  return {
    units: "mm",
    plates: state.plates.map((plate, index) => {
      const stock = plate.setup.stock
      return {
        id: plate.id,
        // As the app shows it: a plate without a name of its own shows its number.
        name: plateLabel(plate, index),
        stock: stock && {
          name: stock.name,
          material: stock.material,
          width: stock.width,
          depth: stock.depth,
          height: stock.height,
        },
      }
    }),
    selectedPlateId: selectedPlate(state)?.id ?? null,
  }
}

type OwnEntry = {
  readonly plateId: string
  readonly operation: Operation
  readonly tools: string
}

/** A plugin's operations by ID, with what their records depend on. */
function ownEntries(
  state: WorkspaceState,
  pluginId: string
): Map<string, OwnEntry> {
  const entries = new Map<string, OwnEntry>()
  for (const plate of state.plates)
    for (const operation of plate.operations)
      if (isOwn(operation, pluginId))
        entries.set(operation.id, {
          plateId: plate.id,
          operation,
          tools: JSON.stringify(toolAssignments(plate, operation)),
        })
  return entries
}

/** Operations added, changed or removed between two snapshots, by plate. */
function changedOperations(
  previous: ReadonlyMap<string, OwnEntry>,
  current: ReadonlyMap<string, OwnEntry>
): Map<string, string[]> {
  const changed = new Map<string, string[]>()
  const note = (plateId: string, operationId: string) =>
    changed.set(plateId, [...(changed.get(plateId) ?? []), operationId])
  for (const [id, entry] of current) {
    const before = previous.get(id)
    if (before?.operation !== entry.operation || before.tools !== entry.tools)
      note(entry.plateId, id)
  }
  for (const [id, entry] of previous)
    if (!current.has(id)) note(entry.plateId, id)
  return changed
}

/**
 * The workspace as plugin views reach it (see WorkspaceMediator). A plugin sees plates and
 * the selection, and reads and writes only its own `plugin` operations; every write is one
 * atomic batch of workspace commands, so a refused step changes nothing.
 */
export function createWorkspaceMediator(
  options: WorkspaceMediatorOptions
): WorkspaceMediator {
  const { workspace, dialogs } = options

  const commit = (commands: readonly WorkspaceCommand[]): WorkspaceState => {
    const result = workspace.dispatch({ type: "batch", commands })
    if (!result.ok) throw new RpcError("FAILED", result.error)
    return result.value
  }

  const installed = (pluginId: string) => {
    const plugin = options.plugin(pluginId)
    if (!plugin)
      throw new RpcError("UNAVAILABLE", "This plugin is not enabled.")
    return plugin
  }

  const records = (
    state: WorkspaceState,
    pluginId: string,
    plateId: string | null
  ): OperationRecord[] =>
    state.plates
      .filter((plate) => plateId === null || plate.id === plateId)
      .flatMap((plate) =>
        plate.operations.flatMap((operation) =>
          isOwn(operation, pluginId) ? [toRecord(plate, operation)] : []
        )
      )

  const findOwn = (
    state: WorkspaceState,
    pluginId: string,
    operationId: string
  ) => {
    for (const plate of state.plates) {
      const operation = plate.operations.find((item) => item.id === operationId)
      if (operation && isOwn(operation, pluginId)) return { plate, operation }
    }
    return null
  }

  const saved = (
    state: WorkspaceState,
    pluginId: string,
    operationId: string
  ): OperationRecord => {
    const found = findOwn(state, pluginId, operationId)
    if (!found)
      throw new RpcError("NOT_FOUND", "This plugin has no such operation.")
    return toRecord(found.plate, found.operation)
  }

  // Summaries only move forward: every change the plugin can see gets a new revision.
  let revision = 0
  let last: { key: string; summary: WorkspaceSummary } | null = null
  const summary = (): WorkspaceSummary => {
    const current = summarize(workspace.state)
    const key = JSON.stringify(current)
    if (last?.key !== key) {
      revision += 1
      last = { key, summary: { ...current, revision } }
    }
    return last.summary
  }

  const draftOperation = (
    pluginId: string,
    version: string,
    draft: OperationDraftRecord
  ): Operation => {
    const operation = createOperation(
      draft.name,
      {
        kind: "plugin",
        pluginId,
        version,
        data: draft.data,
        phase: "machining",
        nc: draft.nc,
      },
      { stopBefore: draft.stopBefore }
    )
    checkOperation(operation)
    return operation
  }

  return {
    readWorkspace: summary,
    subscribeWorkspace: (listener) => {
      let previous = summary()
      return workspace.subscribe(() => {
        const current = summary()
        if (current === previous) return
        previous = current
        listener(current)
      })
    },
    listOperations: (pluginId, plateId) =>
      records(workspace.state, pluginId, plateId),
    createOperations: async (pluginId, plateId, drafts) => {
      const plugin = installed(pluginId)
      const state = workspace.state
      const plate = state.plates.find((item) => item.id === plateId)
      if (!plate) throw new RpcError("NOT_FOUND", "The plate no longer exists.")
      for (const draft of drafts) checkTools(draft.toolAssignments, state.tools)
      const operations = drafts.map((draft) =>
        draftOperation(pluginId, plugin.version, draft)
      )
      // The empty plate is a placeholder: as with other sources, a plate of its own starts,
      // set up and named as the empty plate was.
      const target = plate.example
        ? replacementPlate(plate, options.importContext())
        : plate
      const commands: WorkspaceCommand[] = operations.map(
        (operation, index) => ({
          type: "operation.add",
          plateId: target.id,
          operation,
          preferredTools: assignedTools(
            drafts[index].toolAssignments,
            drafts[index].nc
          ),
        })
      )
      const next = commit(
        target === plate
          ? commands
          : [
              { type: "plates.add", plates: [target], select: true },
              ...commands,
            ]
      )
      const ids = operations.map((operation) => operation.id)
      options.onCreated?.(target.id, ids)
      return ids.map((id) => saved(next, pluginId, id))
    },
    replaceOperation: async (pluginId, expected, next) => {
      const plugin = installed(pluginId)
      const state = workspace.state
      const found = findOwn(state, pluginId, expected.id)
      if (!found)
        throw new RpcError("NOT_FOUND", "This plugin has no such operation.")
      const { plate, operation } = found
      if (canonicalJson(toRecord(plate, operation)) !== canonicalJson(expected))
        throw new RpcError(
          "CONFLICT",
          "This operation changed since it was read. Load it again and retry."
        )
      checkTools(next.toolAssignments, state.tools, expected.toolAssignments)
      const regenerated =
        next.nc !== expected.nc ||
        canonicalJson(next.data) !== canonicalJson(expected.data)
      const source = regenerated
        ? {
            ...operation.source,
            version: plugin.version,
            data: next.data,
            nc: next.nc,
          }
        : operation.source
      checkOperation({
        ...operation,
        name: next.name,
        stopBefore: next.stopBefore,
        source,
      })
      const target = { plateId: plate.id, operationId: operation.id }
      const commands: WorkspaceCommand[] = []
      // The program goes first: its revision check is against changes made since the plugin
      // read the operation, and a rename earlier in this batch would count as one.
      if (regenerated)
        commands.push({
          type: "operation.source",
          ...target,
          source,
          expectedRevision: operation.revision,
        })
      if (next.name !== expected.name)
        commands.push({ type: "operation.rename", ...target, name: next.name })
      if (next.stopBefore !== expected.stopBefore)
        commands.push({
          type: "operation.stopBefore",
          ...target,
          value: next.stopBefore,
        })
      // Assigning is idempotent, so a regenerated program's new tool numbers get theirs too.
      const tools = assignedTools(next.toolAssignments, next.nc)
      if (tools.size)
        commands.push({ type: "operation.tools", ...target, tools })
      if (!commands.length) return toRecord(plate, operation)
      return saved(commit(commands), pluginId, operation.id)
    },
    subscribeOperations: (pluginId, listener) => {
      let previous = ownEntries(workspace.state, pluginId)
      return workspace.subscribe((state) => {
        const current = ownEntries(state, pluginId)
        const changed = changedOperations(previous, current)
        previous = current
        for (const [plateId, operationIds] of changed)
          listener({ plateId, operationIds })
      })
    },
    importPrograms: async (files) => {
      const programs = files.map(
        (file) => new File([file.text], file.name, { type: "text/plain" })
      )
      const before = workspace.state
      const context = options.importContext()
      const target = selectedPlate(before)
      // Parsing is async, so another project can open before it resolves. A save alone
      // leaves `plates` as it was, and an ordinary edit alone leaves `project` as it was, so
      // only opening or starting a different project changes both together; this import must
      // not land there.
      const assertSameProject = () => {
        if (
          workspace.state.project !== before.project &&
          workspace.state.plates !== before.plates
        )
          throw new RpcError(
            "CONFLICT",
            "The project changed before this import finished. Import again."
          )
      }
      if (target && !target.example) {
        const { operations, problems } = await readOperations(programs, context)
        if (problems.length)
          throw new RpcError("INVALID_PARAMS", describeProblems(problems))
        assertSameProject()
        commit(
          operations.map(({ operation, preferredTools }) => ({
            type: "operation.add",
            plateId: target.id,
            operation,
            preferredTools,
          }))
        )
        return operations.length
      }
      const { plates, problems } = await readPlates(programs, context)
      if (problems.length)
        throw new RpcError("INVALID_PARAMS", describeProblems(problems))
      assertSameProject()
      commit([{ type: "plates.add", plates, select: true }])
      return plates.length
    },
    listTools: () => workspace.state.tools.map(pluginTool),
    chooseTool: async (plugin, request, signal) => {
      const chosen = await dialogs.chooseTool(plugin, request, signal)
      const tool =
        chosen &&
        workspace.state.tools.find((item) => item.id === chosen.toolId)
      if (!chosen || !tool) return { status: "canceled" }
      return {
        status: "chosen",
        tool: pluginTool(tool),
        presetId: chosen.presetId,
      }
    },
    confirm: (plugin, request, signal) =>
      dialogs.confirm(plugin, request, signal),
    notify: (plugin, notice) => dialogs.notify(plugin, notice),
    progress: (plugin, progress) => dialogs.progress(plugin, progress),
  }
}
