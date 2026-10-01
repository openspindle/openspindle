import { useEffect, useId, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { RpcError } from "@openspindle/rpc"
import { toast } from "sonner"
import { CircleAlert, FileText, FileUp } from "lucide-react"
import { useWorkspace } from "@/app/workspace/workspace-context"
import { useHost } from "@/platform/host-context"
import type { OperationOf } from "@/domain/operations/kinds"
import type { Plate } from "@/domain/plate/plate"
import type { Tool } from "@/domain/tools/tool"
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MeasurementInput } from "@/components/workspace/measurement-input"
import { ToolCard } from "@/components/workspace/tool-card"
import { ToolChoiceDialog } from "./tool-choice-dialog"
import { usePcb } from "./use-pcb"
import type { Draft, PcbSession } from "./session"
import type { PcbSaveMutation } from "./editor"
import { LIMITS, isDrillFile, parameters } from "@/domain/pcb/manifest.mjs"
import type {
  DrillMethod,
  ParameterDefinition,
  SelectParameter,
} from "@/domain/pcb/manifest.mjs"
import {
  generatedToolSlots,
  multipleToolsMessage,
  operationWarnings,
} from "@/domain/pcb/generation"
import { ACCEPT, hasAcceptedExtension, matchInputs } from "@/domain/pcb/inputs"
import {
  syncOperationAssignments,
  toolAssignments,
} from "@/domain/pcb/operation-assignments"
import type { PCBOperationData, Values } from "@/domain/pcb/operation-data"
import {
  operationName,
  readData,
  stableJson,
} from "@/domain/pcb/operation-data"
import {
  MILL_DRILL,
  drillMethod,
  geometryFields,
  operationGroup,
  operationKind,
  operationKindLabel,
  operationKinds,
  operationRole,
  recommendedKinds,
  toolFields,
  toolValues,
} from "@/domain/pcb/operation-settings"

type Operation = OperationOf<"pcb">
type Stock = NonNullable<Plate["setup"]["stock"]>

function initialDraft(
  operation: Operation,
  saved: PCBOperationData,
  plate: Plate
): Draft {
  // Workspace tool assignments are authoritative for generated operations.
  const data =
    operation.source.nc === null
      ? saved
      : syncOperationAssignments(
          saved,
          operation.source.nc,
          toolAssignments(plate, operation)
        )
  return {
    operationId: operation.id,
    revision: operation.revision,
    source: operation.source,
    dataKey: stableJson(operation.source.data),
    assignmentsKey: stableJson(toolAssignments(plate, operation)),
    data,
    edited: data !== saved,
  }
}

/** One of the editor's own saves: what it sent, from which draft, as saved data reads. */
type OwnSave = {
  readonly dataKey: string
  readonly assignmentsKey: string
  readonly sent: PCBOperationData
  readonly startedFrom: PCBOperationData
}

/** The draft after one of its own saves; edits made meanwhile stay on top of it. */
function followSave(draft: Draft, operation: Operation, own: OwnSave): Draft {
  const revision = operation.revision
  if (draft.revision === revision && draft.source === operation.source)
    return draft
  if (draft.data === own.startedFrom)
    return {
      operationId: draft.operationId,
      revision,
      source: operation.source,
      dataKey: own.dataKey,
      assignmentsKey: own.assignmentsKey,
      data: own.sent,
      edited: false,
    }
  return {
    ...draft,
    revision,
    source: operation.source,
    dataKey: own.dataKey,
    assignmentsKey: own.assignmentsKey,
  }
}

/**
 * Follows the operation to a new revision. The editor's own save keeps the draft, and so
 * do changes to anything but the data (a tool assignment, the name); data changed
 * elsewhere replaces unsaved edits (`replaced`).
 */
function rebase(
  draft: Draft,
  operation: Operation,
  saved: PCBOperationData,
  own: OwnSave | null,
  plate: Plate
): { draft: Draft; replaced: boolean } {
  const assignmentsKey = stableJson(toolAssignments(plate, operation))
  if (
    draft.revision === operation.revision &&
    draft.source === operation.source &&
    draft.assignmentsKey === assignmentsKey
  )
    return { draft, replaced: false }
  const dataKey = stableJson(operation.source.data)
  if (own && dataKey === own.dataKey)
    return {
      draft: followSave(draft, operation, own),
      replaced: false,
    }
  if (dataKey !== draft.dataKey)
    return {
      draft: initialDraft(operation, saved, plate),
      replaced: draft.edited,
    }
  const data =
    operation.source.nc === null
      ? draft.data
      : syncOperationAssignments(
          draft.data,
          operation.source.nc,
          toolAssignments(plate, operation)
        )
  return {
    draft: {
      ...draft,
      revision: operation.revision,
      source: operation.source,
      assignmentsKey,
      data,
      edited: draft.edited || data !== draft.data,
    },
    replaced: false,
  }
}

/**
 * Defaults, then stock-derived depths and the drill method, then the tool and preset, then
 * explicit edits.
 */
function effectiveValues(
  data: PCBOperationData,
  method: DrillMethod,
  tool: Tool | undefined,
  stock: Stock | null
): Values {
  const role = data.file.role
  const values: Values = {}
  for (const parameter of parameters) {
    if (parameter.type === "boolean") values[parameter.id] = parameter.default
    else values[parameter.id] = String(parameter.default)
  }
  if (stock) {
    values.zcut = String(-Number((stock.height + 0.2).toFixed(2)))
    values.zdrill = values.zcut
    values.zbridges = String(
      -Number(Math.max(0, stock.height - 0.6).toFixed(2))
    )
  }
  values.drillMethod = method
  // Cutting values come from the library or an explicit edit, never example defaults.
  for (const key of toolFields(role, method)) values[key] = ""
  if (tool) {
    const preset = tool.presets.find((item) => item.id === data.presetId)
    Object.assign(values, toolValues(role, method, tool, preset, data.values))
  }
  Object.assign(values, data.values)
  return values
}

const recipeKey = (data: PCBOperationData, values: Values) =>
  stableJson({
    file: data.file,
    values,
    toolId: data.toolId,
    presetId: data.presetId,
  })

/** The recipe of the saved program; null while the operation is pending. */
function generatedRecipe(operation: Operation): string | null {
  if (operation.source.nc === null) return null
  const data = readData(operation.source.data)
  if (!data) return null
  return recipeKey(data, data.generatedValues ?? data.values)
}

/** The editor's labels where they differ from the conversion core's. */
const parameterLabel = (parameter: ParameterDefinition) =>
  parameter.id === "cutSide" ? "Machine from" : parameter.label

/** The drill method: the Operation field chooses it (Drill or Mill drill), not a field of its own. */
const methodParameter = parameters.find(
  (parameter): parameter is SelectParameter =>
    parameter.id === "drillMethod" && parameter.type === "select"
)

const isConflict = (error: unknown) =>
  error instanceof RpcError && error.code === "CONFLICT"

/** The converter refused a program that uses more than one tool slot. */
function refusedToolSlots(error: unknown): boolean {
  if (!(error instanceof RpcError) || error.code !== "INVALID_PARAMS")
    return false
  const { data } = error
  return (
    typeof data === "object" &&
    data !== null &&
    "reason" in data &&
    data.reason === "multiple-tool-slots"
  )
}

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

function clip(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

/**
 * Edits one PCB operation. Changes to its file, tool or settings regenerate its program
 * through the converter after a short pause; the result is saved with the revision the
 * editor has seen, and a concurrent change reloads the operation instead of overwriting it.
 */
export function OperationEditor({
  session,
  plate,
  operation,
  saved,
  save,
  disabled,
}: {
  session: PcbSession
  plate: Plate
  operation: Operation
  /** The operation's data, read. */
  saved: PCBOperationData
  /** The operation's revision-checked workspace save. */
  save: PcbSaveMutation
  disabled: boolean
}) {
  const host = useHost()
  const { drafts, updates } = session
  const library = useWorkspace((state) => state.tools)
  const pcb = usePcb()
  const id = useId()
  const observed = `${operation.revision}:${stableJson(toolAssignments(plate, operation))}`

  const [state, setState] = useState(() => {
    const stored = drafts.get(operation.id)
    return {
      draft: stored
        ? rebase(stored, operation, saved, null, plate).draft
        : initialDraft(operation, saved, plate),
      seen: observed,
      source: operation.source,
    }
  })
  const [error, setError] = useState<string | null>(
    saved.generationError ?? null
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)
  const [readingSource, setReadingSource] = useState(false)
  const [choosingTool, setChoosingTool] = useState(false)
  const [chosen, setChosen] = useState<Tool | null>(null)
  const [forced, setForced] = useState(false)
  const [retry, setRetry] = useState(0)

  const ownSave = useRef<OwnSave | null>(null)
  // A new revision of the operation: follow it now, so no render pairs it with a stale draft.
  let draft = state.draft
  if (state.seen !== observed || state.source !== operation.source) {
    const next = rebase(draft, operation, saved, ownSave.current, plate)
    if (next.replaced)
      setNotice(
        "This operation was changed elsewhere; its saved settings replaced your unsaved changes."
      )
    draft = next.draft
    setState({ draft: next.draft, seen: observed, source: operation.source })
  }

  const latest = useRef(draft)
  const mounted = useRef(true)
  const request = useRef<AbortController | null>(null)
  const readLock = useRef(false)
  const replaceInput = useRef<HTMLInputElement>(null)
  const rejectedSource = useRef<string | null>(null)
  const lastSaved = useRef<{ revision: number; key: string } | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    latest.current = draft
    if (draft.edited) drafts.set(draft.operationId, draft)
    else drafts.delete(draft.operationId)
  }, [draft])

  const data = draft.data
  const role = useMemo(() => operationRole(data.file), [data.file])
  const kinds = useMemo(() => operationKinds(data.file), [data.file])
  const drillFile = useMemo(() => isDrillFile(data.file), [data.file])
  const method = useMemo(() => drillMethod(data), [data])
  const kind = useMemo(() => operationKind(data), [data])
  const group = operationGroup(role)
  const cuttingFields = toolFields(role, method)
  // A tool chosen a moment ago may not be in the library list yet.
  const tool =
    library.find((item) => item.id === data.toolId) ??
    (chosen?.id === data.toolId ? chosen : undefined)
  const stock = plate.setup.stock
  const values = effectiveValues(data, method, tool, stock)
  const valuesKey = stableJson(values)
  // valuesKey stands for values: the key only changes when a value does.
  const generationKey = useMemo(
    () => recipeKey(data, values),
    [data, valuesKey]
  )
  const generatedKey = useMemo(() => generatedRecipe(operation), [operation])
  const upToDateKey =
    lastSaved.current?.revision === operation.revision
      ? lastSaved.current.key
      : generatedKey
  const savedSlots =
    operation.source.nc === null ? [] : generatedToolSlots(operation.source.nc)
  const invalidSavedSource = savedSlots.length > 1
  const missingCuttingValues = cuttingFields.filter(
    (key) => String(values[key] ?? "").trim() === ""
  )
  const inactive = disabled || readingSource || choosingTool
  const converterStatus = pcb.status.data
  // The converter must be available before a recipe can update its toolpath.
  const canGenerate =
    !!group &&
    !!tool &&
    !pcb.status.isPending &&
    !missingCuttingValues.length &&
    !data.generationError &&
    !invalidSavedSource &&
    converterStatus?.status === "ready"
  const needsUpdate = canGenerate && (forced || upToDateKey !== generationKey)

  function setData(update: (data: PCBOperationData) => PCBOperationData) {
    setState((current) => ({
      ...current,
      draft: {
        ...current.draft,
        data: update(current.draft.data),
        edited: true,
      },
    }))
  }

  function stopUpdate() {
    request.current?.abort()
    updates.get(operation.id)?.abort()
  }

  /** Applies an edit; it clears a refused generation so the operation can try again. */
  function change(next: PCBOperationData): PCBOperationData {
    stopUpdate()
    const cleared: PCBOperationData = { ...next }
    delete cleared.generationError
    setData(() => cleared)
    setError(null)
    setNotice(null)
    return cleared
  }

  /** Keeps the draft (and a kept working copy) in step with one of its own saves. */
  function settle(result: Operation, own: OwnSave) {
    const stored = drafts.get(result.id)
    if (stored) {
      const next = followSave(stored, result, own)
      if (next.edited) drafts.set(result.id, next)
      else drafts.delete(result.id)
    }
    if (mounted.current)
      setState((current) => ({
        ...current,
        draft: followSave(current.draft, result, own),
      }))
  }

  /**
   * Saves against the revision the draft has seen, even if a newer one was read since; a
   * concurrent change fails with CONFLICT and the workspace supplies the new operation, which the
   * draft follows (updating again if still needed). The name follows the file only when
   * the file or its type changed, so a renamed operation keeps its name.
   */
  async function persist(
    next: PCBOperationData,
    program: { nc: string | null; toolAssignments: Record<string, string> },
    startedFrom: PCBOperationData
  ): Promise<Operation> {
    const name = operationName(next)
    const json = next
    const own: OwnSave = {
      dataKey: stableJson(json),
      assignmentsKey: stableJson(program.toolAssignments),
      sent: next,
      startedFrom,
    }
    ownSave.current = own
    try {
      const result = await save.mutateAsync({
        session: session.id,
        revision: latest.current.revision,
        expectedSource: latest.current.source,
        assignmentsKey: latest.current.assignmentsKey,
        ...(name === operationName(saved) ? {} : { name }),
        data: json,
        nc: program.nc,
        toolAssignments: program.toolAssignments,
      })
      settle(result, own)
      return result
    } finally {
      if (ownSave.current === own) ownSave.current = null
    }
  }

  /** A generation the PCB feature refuses leaves the operation pending with the reason. */
  async function reject(rejected: PCBOperationData, message: string) {
    stopUpdate()
    const blocked: PCBOperationData = { ...rejected, generationError: message }
    setData(() => blocked)
    setError(message)
    setUpdating(false)
    try {
      await persist(blocked, { nc: null, toolAssignments: {} }, blocked)
    } catch (problem) {
      if (!isConflict(problem))
        setError(
          `Could not block this operation: ${errorText(problem, "saving failed.")}`
        )
    }
  }

  /** A new source or type that needs a tool first is kept as a pending operation. */
  async function savePending(next: PCBOperationData) {
    try {
      await persist(next, { nc: null, toolAssignments: {} }, next)
    } catch (problem) {
      if (!isConflict(problem))
        setError(
          `Could not save this operation: ${errorText(problem, "saving failed.")}`
        )
    }
  }

  function changeSource(next: PCBOperationData) {
    const applied = change(next)
    if (!applied.toolId) void savePending(applied)
  }

  function notifyWarnings(name: string, warnings: readonly string[]) {
    const text = warnings
      .map((warning) => warning.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
    if (!text) return
    toast.warning(clip(`${name} updated. ${text}`, 500))
  }

  const update = useRef<(controller: AbortController) => Promise<void>>(
    async () => {}
  )
  update.current = async (controller) => {
    const startedFrom = data
    const startedKey = generationKey
    const recipe = values
    setError(null)
    try {
      controller.signal.throwIfAborted()
      if ((role === "outline" || role === "drill") && !stock)
        throw new Error(
          "Assign stock to this plate in the workspace before generating this operation."
        )
      const settings: Record<string, number | boolean | string> = {}
      for (const parameter of parameters) {
        if (parameter.group !== group && parameter.group !== "board") continue
        if ((parameter.method ?? method) !== method) continue
        const value = recipe[parameter.id] as string | boolean | undefined
        if (parameter.type === "number") {
          const number = Number(value)
          if (String(value).trim() === "" || !Number.isFinite(number))
            throw new Error(`${parameterLabel(parameter)} is required.`)
          if (number < parameter.min || number > parameter.max)
            throw new Error(
              `${parameterLabel(parameter)} is outside its supported range.`
            )
          settings[parameter.id] = number
        } else if (value !== undefined) settings[parameter.id] = value
      }
      // Separate operations share the KiCad origin; never shift one file on its own.
      settings.zeroStart = false
      if (
        role !== "front" &&
        role !== "back" &&
        role !== "outline" &&
        role !== "drill"
      )
        throw new Error("Choose an operation before generating its toolpath.")
      const generated = await host.pcb.generate(
        {
          schemaVersion: 1,
          files: [{ ...startedFrom.file, role }],
          parameters: settings,
        },
        controller.signal
      )
      controller.signal.throwIfAborted()
      if (generated.programs.length !== 1)
        throw new Error("This source must produce exactly one operation.")
      const source = generated.programs[0].source
      const emitted = generatedToolSlots(source)
      if (emitted.length > 1) {
        await reject(startedFrom, multipleToolsMessage(emitted, role))
        return
      }
      const sent: PCBOperationData = {
        ...startedFrom,
        generatedValues: recipe,
      }
      delete sent.generationError
      const result = await persist(
        sent,
        {
          nc: source,
          toolAssignments: { [emitted[0] ?? "default"]: startedFrom.toolId },
        },
        startedFrom
      )
      lastSaved.current = { revision: result.revision, key: startedKey }
      if (mounted.current) setForced(false)
      notifyWarnings(
        result.name,
        operationWarnings(generated.warnings, {
          role,
          drillSide: settings.drillSide,
          zeroStart: settings.zeroStart,
        })
      )
    } catch (problem) {
      if (controller.signal.aborted || isConflict(problem)) return
      const message = errorText(problem, "Could not update this toolpath.")
      if (refusedToolSlots(problem)) await reject(startedFrom, message)
      else setError(message)
    } finally {
      if (updates.get(operation.id) === controller) updates.delete(operation.id)
      if (request.current === controller) {
        request.current = null
        setUpdating(false)
      }
    }
  }

  // A saved program with several tool slots, which this editor never saves: block it once.
  useEffect(() => {
    if (!invalidSavedSource || disabled || operation.source.nc === null) return
    if (rejectedSource.current === operation.source.nc) return
    rejectedSource.current = operation.source.nc
    void reject(data, multipleToolsMessage(savedSlots, role))
  }, [invalidSavedSource, disabled, operation.source.nc, retry])

  useEffect(() => {
    updates.get(operation.id)?.abort()
    updates.delete(operation.id)
    if (inactive || !needsUpdate) {
      setUpdating(false)
      return
    }
    const controller = new AbortController()
    updates.set(operation.id, controller)
    request.current = controller
    setUpdating(true)
    const timer = setTimeout(() => void update.current(controller), 450)
    return () => {
      // Leaving the operation lets its scheduled update finish.
      if (!mounted.current) return
      clearTimeout(timer)
      controller.abort()
      if (updates.get(operation.id) === controller) updates.delete(operation.id)
      if (request.current === controller) request.current = null
    }
  }, [
    generationKey,
    needsUpdate,
    inactive,
    retry,
    draft.revision,
    draft.source,
    draft.assignmentsKey,
    operation.id,
  ])

  function updateValue(key: string, value: string | boolean) {
    change({ ...data, values: { ...data.values, [key]: value } })
  }

  /**
   * The app's tool chooser, opened on the tool types this operation usually takes, then its
   * preset step: a preset applies its cutting values, declining keeps the current values,
   * and cancelling keeps the current tool.
   */
  function selectTool() {
    if (inactive) return
    stopUpdate()
    setChoosingTool(true)
    setError(null)
  }

  function applyTool(selected: Tool, presetId: string | null) {
    if (
      presetId !== null &&
      !selected.presets.some((item) => item.id === presetId)
    ) {
      setError(
        "This tool or preset has changed. Choose it again from the library."
      )
      return
    }
    const overrides: Values = { ...data.values }
    for (const key of cuttingFields) {
      delete overrides[key]
      // Declining the preset keeps the current cutting values; a new tool brings its size.
      const geometry = geometryFields.includes(key)
      if (presetId === null && (!geometry || selected.id === data.toolId))
        overrides[key] = values[key] ?? ""
    }
    setChosen(selected)
    change({
      ...data,
      toolId: selected.id,
      presetId: presetId ?? "",
      values: overrides,
    })
  }

  /** Another method takes another kind of tool: the operation waits for one again. */
  function changeMethod(next: DrillMethod) {
    if (next === method) return
    const kept: Values = { ...data.values, drillMethod: next }
    for (const key of cuttingFields) delete kept[key]
    changeSource({ ...data, toolId: "", presetId: "", values: kept })
  }

  /**
   * Another kind of operation keeps the file and waits for a tool again, as each takes its
   * own settings and kind of tool. For a drill file, Drill or Mill drill decides how its
   * holes are made, whatever sizes it has.
   */
  function changeKind(next: string) {
    if (next === kind) return
    const nextRole = next === MILL_DRILL ? "drill" : next
    const nextMethod: DrillMethod = next === MILL_DRILL ? "mill" : "drill"
    if (nextRole === "drill" && role === "drill") {
      changeMethod(nextMethod)
      return
    }
    changeSource({
      ...data,
      file: { ...data.file, role: nextRole },
      toolId: "",
      presetId: "",
      values: nextRole === "drill" ? { drillMethod: nextMethod } : {},
    })
  }

  async function replace(file: File | undefined) {
    if (!file || inactive || readLock.current) return
    stopUpdate()
    readLock.current = true
    setReadingSource(true)
    setError(null)
    try {
      if (!hasAcceptedExtension(file.name))
        throw new Error("Choose a Gerber or drill file.")
      if (file.size > LIMITS.inputFile)
        throw new Error("Choose a source file smaller than 8 MiB.")
      const content = await file.text()
      const roles = matchInputs({ name: file.name, content })
      const detected = roles.length === 1 ? roles[0] : ""
      // Keeping the operation's identity, a file of another type starts over.
      let next = data
      if (detected !== role)
        next = { ...data, values: {}, toolId: "", presetId: "" }
      // Whatever sizes the new file has, the chosen tool keeps the method it was chosen for.
      else if (group === "drilling" && data.toolId)
        next = { ...data, values: { ...data.values, drillMethod: method } }
      changeSource({
        ...next,
        file: { name: file.name, content, role: detected },
      })
    } catch (problem) {
      setError(errorText(problem, "Could not read this file."))
    } finally {
      readLock.current = false
      setReadingSource(false)
    }
  }

  function renderParameter(parameter: ParameterDefinition) {
    const inputId = `${id}-${parameter.id}`
    const value = values[parameter.id]
    let control: ReactNode
    if (parameter.type === "boolean") {
      control = (
        <Checkbox
          id={inputId}
          checked={value === true}
          disabled={inactive}
          onCheckedChange={(checked) => updateValue(parameter.id, checked)}
        />
      )
    } else if (parameter.type === "select") {
      control = (
        <Select
          items={parameter.options}
          value={String(value)}
          disabled={inactive}
          onValueChange={(next) => {
            if (next !== null) updateValue(parameter.id, next)
          }}
        >
          <SelectTrigger id={inputId} className="w-[118px] min-w-0 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {parameter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )
    } else {
      control = (
        <MeasurementInput
          id={inputId}
          type="number"
          value={String(value)}
          unit={parameter.unit}
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          required
          disabled={inactive || (!tool && cuttingFields.includes(parameter.id))}
          onChange={(event) => updateValue(parameter.id, event.target.value)}
        />
      )
    }
    return (
      <Field
        key={parameter.id}
        orientation="horizontal"
        className="min-w-0 [&>[data-slot=input-group]]:w-[118px] [&>[data-slot=input-group]]:shrink-0"
      >
        <FieldLabel htmlFor={inputId}>{parameterLabel(parameter)}</FieldLabel>
        {control}
      </Field>
    )
  }

  const sourceType = drillFile ? "Excellon" : "Gerber"
  const sourceSize = Math.max(
    1,
    Math.ceil(new TextEncoder().encode(data.file.content).byteLength / 1024)
  )
  const mirrored =
    role === "back" ||
    (role === "drill" && values.drillSide === "back") ||
    (role === "outline" && values.cutSide === "back")
  const mirrorAxis = parameters.find(
    (parameter) => parameter.id === "mirrorAxis"
  )
  const toolLabel = "Choose tool from library…"
  const converterProblem =
    pcb.status.error?.message ??
    (converterStatus?.status !== "ready" ? converterStatus?.message : null)

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {choosingTool && !disabled && (
        <ToolChoiceDialog
          selectedToolId={tool?.id ?? ""}
          recommendedKinds={recommendedKinds(role, method)}
          stockMaterial={stock?.material}
          onChoose={(selected, presetId) => {
            applyTool(selected, presetId)
            setChoosingTool(false)
          }}
          onCancel={() => setChoosingTool(false)}
        />
      )}
      {/* What stops the toolpath, at the top as the app shows its own problems. */}
      {converterProblem && (
        <Alert variant="warning">
          <CircleAlert />
          <AlertDescription>
            {pcb.check.error?.message ??
              pcb.choose.error?.message ??
              converterProblem}
          </AlertDescription>
          {converterStatus?.status !== "ready" && (
            <AlertAction>
              <Button
                type="button"
                variant="warning"
                size="xs"
                disabled={pcb.choose.isPending}
                onClick={() => pcb.choose.mutate()}
              >
                Choose pcb2gcode
              </Button>
              <Button
                type="button"
                variant="warning"
                size="xs"
                disabled={pcb.check.isPending}
                onClick={() => pcb.check.mutate()}
              >
                {pcb.check.isPending ? "Checking…" : "Check again"}
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}
      {error && (
        <Alert variant="warning">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="warning"
              size="xs"
              disabled={inactive}
              onClick={() => {
                rejectedSource.current = null
                setForced(true)
                change(data)
                setRetry((current) => current + 1)
              }}
            >
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => event.preventDefault()}
      >
        <Attachment
          className="w-full"
          state={readingSource ? "processing" : "done"}
        >
          <AttachmentMedia>
            <FileText />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle title={data.file.name}>
              {data.file.name}
            </AttachmentTitle>
            <AttachmentDescription>
              {sourceType} · {sourceSize} KB
            </AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              type="button"
              aria-label="Replace file"
              title="Replace file"
              disabled={inactive}
              onClick={() => replaceInput.current?.click()}
            >
              <FileUp />
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
        <Input
          ref={replaceInput}
          hidden
          type="file"
          accept={ACCEPT}
          aria-label="Replace operation source"
          disabled={inactive}
          onChange={(event) => {
            void replace(event.target.files?.[0])
            event.target.value = ""
          }}
        />
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-kind`}>Operation</FieldLabel>
            <Select
              items={[
                { value: "", label: "Choose operation…" },
                ...kinds.map((value) => ({
                  value,
                  label: operationKindLabel(value),
                })),
              ]}
              value={kind}
              disabled={inactive}
              onValueChange={(value) => {
                if (value !== null) changeKind(value)
              }}
            >
              <SelectTrigger id={`${id}-kind`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="">Choose operation…</SelectItem>
                  {kinds.map((value) => (
                    <SelectItem key={value} value={value}>
                      {operationKindLabel(value)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {group && (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-tool`}>Tool</FieldLabel>
                <ToolCard
                  id={`${id}-tool`}
                  tool={tool}
                  aria-label="Choose tool from library"
                  emptyLabel={toolLabel}
                  disabled={inactive}
                  onClick={() => void selectTool()}
                />
              </Field>
              {tool && missingCuttingValues.length > 0 && (
                <FieldDescription>
                  Enter the missing cutting values:{" "}
                  {missingCuttingValues
                    .map((key) => {
                      const parameter = parameters.find(
                        (item) => item.id === key
                      )
                      return parameter ? parameterLabel(parameter) : key
                    })
                    .join(", ")}
                  .
                </FieldDescription>
              )}
              <FieldGroup className="gap-3">
                {parameters
                  .filter(
                    (parameter) =>
                      parameter.group === group &&
                      parameter !== methodParameter &&
                      (parameter.method ?? method) === method
                  )
                  .map(renderParameter)}
              </FieldGroup>
              {mirrored && mirrorAxis && (
                <FieldGroup>{renderParameter(mirrorAxis)}</FieldGroup>
              )}
            </>
          )}
        </FieldGroup>
      </form>
      {updating && (
        <FieldDescription role="status">Updating toolpath…</FieldDescription>
      )}
      {notice && <FieldDescription role="status">{notice}</FieldDescription>}
    </div>
  )
}
