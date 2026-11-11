import { bedOffsetOf } from "@/domain/anchors/stored-anchors"
import { useId, useState } from "react"
import { useForm } from "@tanstack/react-form"
import { z } from "zod"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import {
  selectedPlate,
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { createOperation } from "@/domain/operations/operation"
import {
  FacingParamsSchema,
  facingToolIssue,
  facingKeepOuts,
  facingPocketPaths,
  facingEntryFrameIssue,
} from "@/domain/operations/facing"
import type { FacingParams } from "@/domain/operations/facing"
import type { PlateSetup } from "@/domain/plate/plate"
import { createPreset } from "@/domain/tools/tool"
import type { Tool } from "@/domain/tools/tool"
import { kitForPlate } from "@/domain/fixtures/catalog"
import {
  useProbingDraft,
  useProbingForm,
} from "@/features/probing/probing-form"
import {
  MeasurementField,
  probingField,
} from "@/features/probing/probing-fields"
import { AppDialog } from "@/features/shell/app-dialog"
import { openDialog } from "@/features/shell/dialogs"
import { usePrepareSelection } from "@/features/prepare/plate-tree/use-prepare-selection"

const FIELDS: {
  key: {
    [K in keyof FacingParams]-?: NonNullable<FacingParams[K]> extends number
      ? K
      : never
  }[keyof FacingParams]
  label: string
  unit: string
  description?: string
}[] = [
  { key: "x", label: "Front-left X", unit: "mm" },
  { key: "y", label: "Front-left Y", unit: "mm" },
  { key: "width", label: "Width · X", unit: "mm" },
  { key: "depth", label: "Depth · Y", unit: "mm" },
  {
    key: "top",
    label: "Starting top Z",
    unit: "mm",
    description:
      "Work coordinates. Match the measured surface and the actual work Z.",
  },
  { key: "removal", label: "Total removal", unit: "mm" },
  { key: "clearance", label: "Clearance above top", unit: "mm" },
  { key: "rpm", label: "Spindle", unit: "rpm" },
  { key: "feed", label: "Cutting feed", unit: "mm/min" },
  {
    key: "plunge",
    label: "Entry feed",
    unit: "mm/min",
    description: "Vertical feed while entering the verified clear space.",
  },
  { key: "stepdown", label: "Depth per pass", unit: "mm" },
  { key: "stepover", label: "Stepover", unit: "mm" },
]

const ENTRY_FIELDS: typeof FIELDS = [
  { key: "entryX", label: "Pocket centre X", unit: "mm" },
  { key: "entryY", label: "Pocket centre Y", unit: "mm" },
  { key: "entryDiameter", label: "Measured clear opening", unit: "mm" },
  { key: "entryDepth", label: "Measured clear depth from top", unit: "mm" },
]

function ChipLoadCalculator({
  tool,
  params,
  onApply,
}: {
  tool: Tool
  params: FacingParams
  onApply: (feed: number) => void
}) {
  const [chip, setChip] = useState(0)
  const [valid, setValid] = useState(false)
  const form = useProbingForm(
    { chip: 0 },
    z.object({ chip: z.number().positive().max(10) }),
    (value) => setChip(value.chip),
    setValid
  )
  const id = useId()
  const teeth = tool.flutes ?? tool.geometry.numberOfTeeth
  const feed = params.rpm * (teeth ?? 0) * chip
  return (
    <FieldGroup>
      {probingField(
        form,
        "chip"
      )((field) => (
        <MeasurementField
          id={id}
          label="Target chip load · from your cutter data"
          unit="mm/tooth"
          value={field.value || null}
          errors={field.errors}
          disabled={false}
          onBlur={field.onBlur}
          onValueChange={(value) => field.onChange(value ?? NaN)}
        />
      ))}
      <Button
        variant="outline"
        disabled={
          !valid || !teeth || params.rpm <= 0 || feed <= 0 || feed > 100000
        }
        onClick={() => onApply(feed)}
      >
        Use calculated feed
        {valid && teeth && params.rpm > 0 ? ` · ${feed.toFixed(0)} mm/min` : ""}
      </Button>
    </FieldGroup>
  )
}

function FacingFields({
  value,
  setup,
  onChange,
  onValidityChange,
}: {
  value: FacingParams
  setup: PlateSetup | undefined
  onChange: (p: FacingParams) => void
  onValidityChange: (valid: boolean) => void
}) {
  // Keep raw drafts, including invalid geometry, when presets replace cutting fields.
  const schema: z.ZodType<FacingParams, FacingParams> = FacingParamsSchema
  const form = useForm({
    defaultValues: value,
    validators: { onChange: schema },
    listeners: {
      onChange: ({ formApi }) => {
        onValidityChange(
          FacingParamsSchema.safeParse(formApi.state.values).success
        )
        onChange(formApi.state.values)
      },
    },
  })
  const id = useId()
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={`${id}-pattern`}>Facing pattern</FieldLabel>
        <form.Field name="pattern">
          {(field) => (
            <OptionSelect
              id={`${id}-pattern`}
              value={field.state.value ?? "horizontal"}
              options={[
                { value: "horizontal", label: "Horizontal · X" },
                { value: "vertical", label: "Vertical · Y" },
                { value: "cross-hatch", label: "Cross-hatch · X then Y" },
              ]}
              onValueChange={field.handleChange}
            />
          )}
        </form.Field>
        <FieldDescription>
          Cross-hatch cuts both directions at the same Z for each depth pass. It
          does not double the removal.
        </FieldDescription>
      </Field>
      <form.Field name="borderFirst">
        {(field) => (
          <Field orientation="horizontal">
            <Checkbox
              id={`${id}-border`}
              checked={field.state.value ?? false}
              disabled={value.entryMode !== "pocket"}
              onCheckedChange={(checked) =>
                field.handleChange(checked === true)
              }
            />
            <FieldLabel htmlFor={`${id}-border`}>
              Border first · requires a verified cleared pocket
            </FieldLabel>
          </Field>
        )}
      </form.Field>
      <Field>
        <FieldLabel>Entry method</FieldLabel>
        <form.Field name="entryMode">
          {(field) => (
            <ToggleGroup
              variant="outline"
              aria-label="Facing entry method"
              value={[field.state.value ?? "outside"]}
              onValueChange={(values) => {
                const mode = values[0]
                if (mode !== "outside" && mode !== "pocket") return
                if (mode === "outside") {
                  form.setFieldValue("borderFirst", false)
                  form.setFieldValue("entryX", undefined)
                  form.setFieldValue("entryY", undefined)
                  form.setFieldValue("entryDiameter", undefined)
                  form.setFieldValue("entryDepth", undefined)
                  form.setFieldValue("entryFrame", undefined)
                }
                form.setFieldValue("entryConfirmed", false)
                field.handleChange(mode)
              }}
            >
              <ToggleGroupItem value="outside">Outside stock</ToggleGroupItem>
              <ToggleGroupItem value="pocket">Cleared pocket</ToggleGroupItem>
            </ToggleGroup>
          )}
        </form.Field>
      </Field>
      {value.entryMode === "pocket" && (
        <FieldDescription>
          X/Y and width/depth define the cutter-centre rectangle. The cutter
          extends beyond it by its radius; corners and the tool-setter patch may
          remain unfaced. The entire cutter must fit in the pocket before it
          lowers.
        </FieldDescription>
      )}
      {[...FIELDS, ...(value.entryMode === "pocket" ? ENTRY_FIELDS : [])].map(
        ({ key, label, unit, description }) =>
          probingField(
            form,
            key
          )((field) => (
            <MeasurementField
              key={key}
              id={`${id}-${key}`}
              label={label}
              description={description}
              unit={unit}
              value={field.value ?? null}
              errors={field.errors}
              disabled={false}
              onBlur={field.onBlur}
              onValueChange={(v) => {
                if (key.startsWith("entry") || key === "top")
                  form.setFieldValue("entryConfirmed", false)
                field.onChange(v ?? NaN)
              }}
            />
          ))
      )}
      {value.entryMode === "pocket" && (
        <form.Field name="entryConfirmed">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-entry-confirmed`}
                checked={
                  field.state.value === true &&
                  !!setup &&
                  !facingEntryFrameIssue(value, setup)
                }
                disabled={!setup}
                onCheckedChange={(checked) => {
                  if (!setup) return
                  form.setFieldValue(
                    "entryFrame",
                    structuredClone({
                      deviceId: setup.deviceId,
                      workOrigin: setup.workOrigin,
                      anchors: setup.anchors,
                    })
                  )
                  field.handleChange(checked === true)
                }}
              />
              <FieldLabel htmlFor={`${id}-entry-confirmed`}>
                I checked this pocket's position, opening and clear depth on the
                installed bed, including screws, pins and metal underneath.
              </FieldLabel>
            </Field>
          )}
        </form.Field>
      )}
    </FieldGroup>
  )
}

export function FacingDialog({
  plateId: requestedPlate,
  operationId,
  onClose,
}: {
  plateId?: string
  operationId?: string
  onClose: () => void
}) {
  const workspace = useWorkspaceStore()
  const selected = useWorkspace(selectedPlate)
  const [plateId] = useState(requestedPlate ?? selected?.id ?? null)
  const plate = useWorkspace((state) =>
    state.plates.find((p) => p.id === plateId)
  )
  const tools = useWorkspace((state) => state.tools)
  const selection = usePrepareSelection()
  const operation = plate?.operations.find((op) => op.id === operationId)
  const source = operation?.source.kind === "facing" ? operation.source : null
  const [revision] = useState(operation?.revision)
  const existingToolId = plate?.tools.find(
    (entry) =>
      entry.number ===
      operation?.tools.find((binding) => binding.local === source?.tool)?.plate
  )?.toolId
  const [toolId, setToolId] = useState(
    operationId !== undefined
      ? (existingToolId ?? "")
      : (tools.find((tool) => !facingToolIssue(tool))?.id ?? "")
  )
  const tool = tools.find((item) => item.id === toolId)
  const [params, setParams] = useState<FacingParams>(() => {
    if (source) return source.params
    const stock = plate?.setup.stock
    const origin = plate?.setup.workOrigin ?? [0, 0, 0]
    const anchor = plate?.setup.stockAnchor ?? [0, 0, 0]
    return {
      x: anchor[0] - origin[0],
      y: anchor[1] - origin[1],
      width: stock?.width ?? 100,
      depth: stock?.depth ?? 100,
      top: anchor[2] + (stock?.height ?? 0) - origin[2],
      diameter: tool?.diameter ?? 1,
      removal: 0.1,
      stepdown: 0.1,
      stepover: (tool?.diameter ?? 1) / 2,
      clearance: 5,
      rpm: 0,
      feed: 0,
      plunge: 0,
    }
  })
  const [valid, setValid] = useState(
    FacingParamsSchema.safeParse(params).success
  )
  const draft = useProbingDraft(params, setParams)
  const [presetId, setPresetId] = useState("")
  const [presetName, setPresetName] = useState("")
  const presetForm = useForm({
    defaultValues: { name: "" },
    validators: {
      onChange: z.object({ name: z.string().trim().min(1).max(200) }),
    },
    listeners: {
      onChange: ({ formApi }) => setPresetName(formApi.state.values.name),
    },
  })
  const presetNameId = useId()
  const issue = facingToolIssue(tool)
  const preset = tool?.presets.find((item) => item.id === presetId)
  const kit = plate ? kitForPlate(plate) : null
  const pocketIssue =
    plate && kit
      ? (facingEntryFrameIssue(params, plate.setup) ??
        facingPocketPaths(params, facingKeepOuts(plate.setup, kit)).issue)
      : null
  const guard =
    !plate ||
    issue !== null ||
    !valid ||
    pocketIssue !== null ||
    (operationId !== undefined && (!source || operation?.revision !== revision))
  const savePreset = () => {
    if (!tool || !valid || !presetName.trim()) return
    const next = {
      ...createPreset(tool.presets),
      name: presetName.trim(),
      material: plate?.setup.stock?.material ?? null,
      rpm: params.rpm,
      feedRate: params.feed,
      plungeFeed: params.plunge,
      stepdown: params.stepdown,
      stepover: params.stepover,
      useStepdown: true,
      useStepover: true,
      feedPerTooth: chipLoad(tool, params),
    }
    const result = workspace.dispatch({
      type: "library.tools",
      tools: workspace.state.tools.map((item) =>
        item.id === tool.id
          ? { ...item, presets: [...item.presets, next] }
          : item
      ),
    })
    if (!result.ok) toast.error(result.error)
    else {
      setPresetId(next.id)
      toast.success("Cutting preset saved to this tool.")
    }
  }
  const apply = () => {
    if (guard || !tool || !FacingParamsSchema.safeParse(params).success) return
    const nextSource = {
      kind: "facing" as const,
      tool: source?.tool ?? 1,
      params,
    }
    if (operation) {
      const result = workspace.dispatch({
        type: "operation.source",
        plateId: plate.id,
        operationId: operation.id,
        expectedRevision: revision,
        source: nextSource,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
    } else {
      const added = createOperation("Facing", nextSource)
      const result = workspace.dispatch({
        type: "operation.add",
        plateId: plate.id,
        operation: added,
        preferredTools: new Map([[nextSource.tool, tool.id]]),
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      selection.selectOperation(plate.id, added.id)
    }
    onClose()
  }
  return (
    <AppDialog
      title={operation ? "Edit facing" : "Facing wizard"}
      width="wide"
      onClose={onClose}
      footer={
        <Button disabled={guard} onClick={apply}>
          {operation ? "Apply parameters" : "Create facing operation"}
        </Button>
      }
    >
      <FieldGroup>
        <FieldDescription>
          Creates an editable rectangular raster in work coordinates. Choose
          outside-stock entry or a measured clear pocket. Review the generated
          program and clamp clearances on Job before Run. This does not set
          physical work Z or change the stock model.
        </FieldDescription>
        {!!kit?.facingKeepOuts.length && (
          <FieldDescription>
            Automatically avoids{" "}
            {kit.facingKeepOuts
              .map((area) => area.name.toLowerCase())
              .join(", ")}
            , including the cutter radius and at least{" "}
            {Math.max(...kit.facingKeepOuts.map((area) => area.margin))} mm
            clearance. Pocket entry connects rows at cutting feed around
            protected areas; travel clears the modeled equipment top. The
            protected patch stays unfaced.
          </FieldDescription>
        )}
        {!plate && (
          <Button
            variant="outline"
            onClick={() => openDialog({ kind: "guided-setup" })}
          >
            Create a setup first
          </Button>
        )}
        <Field>
          <FieldLabel>Cutter</FieldLabel>
          <OptionSelect
            value={toolId}
            disabled={!!operation}
            options={tools
              .filter((item) => !facingToolIssue(item))
              .map((item) => ({
                value: item.id,
                label: `${item.name} · Ø${item.diameter} mm`,
              }))}
            onValueChange={(id) => {
              setToolId(id)
              setPresetId("")
              const diameter = tools.find((t) => t.id === id)?.diameter ?? 1
              const next = {
                ...params,
                diameter,
                stepover: Math.min(params.stepover, diameter / 2),
                entryConfirmed: false,
              }
              setParams(next)
              setValid(FacingParamsSchema.safeParse(next).success)
            }}
          />
        </Field>
        {issue && (
          <FieldDescription>
            {issue}{" "}
            {operation
              ? "Assign a suitable cutter in the plate's tool table before editing Facing."
              : "Edit the tool library before continuing."}
          </FieldDescription>
        )}
        {tool && tool.diameter !== params.diameter && (
          <Button
            variant="outline"
            onClick={() => {
              const diameter = tool.diameter ?? params.diameter
              const next = {
                ...params,
                diameter,
                stepover: Math.min(params.stepover, diameter / 2),
                entryConfirmed: false,
              }
              setParams(next)
              setValid(FacingParamsSchema.safeParse(next).success)
            }}
          >
            Use current cutter diameter · {tool.diameter} mm
          </Button>
        )}
        <FieldDescription>
          Feeds and speeds assistant: load cutting data supplied for your cutter
          and material, or enter your own. These values require operator review.
          Imported G-code keeps its original cutting data.
          {kit?.spindleRange &&
            ` This machine's spindle range is ${kit.spindleRange.min}–${kit.spindleRange.max} rpm.`}
        </FieldDescription>
        <Field>
          <FieldLabel>Library cutting preset</FieldLabel>
          <OptionSelect
            value={presetId}
            options={[
              { value: "", label: "Choose a preset" },
              ...(tool?.presets.map((item) => ({
                value: item.id,
                label: `${item.name}${item.material ? ` · ${item.material}` : ""}`,
              })) ?? []),
            ]}
            onValueChange={setPresetId}
          />
        </Field>
        <Button
          variant="outline"
          disabled={!preset}
          onClick={() => {
            if (!preset) return
            const next = {
              ...params,
              rpm: preset.rpm ?? 0,
              feed: preset.feedRate ?? 0,
              plunge: preset.plungeFeed ?? 0,
              stepdown:
                preset.useStepdown === true
                  ? (preset.stepdown ?? params.stepdown)
                  : params.stepdown,
              stepover:
                preset.useStepover === true
                  ? (preset.stepover ?? params.stepover)
                  : params.stepover,
            }
            setValid(FacingParamsSchema.safeParse(next).success)
            setParams(next)
          }}
        >
          Apply preset to facing parameters
        </Button>
        <FacingFields
          key={`${toolId}-${draft.key}`}
          value={params}
          setup={plate?.setup}
          onChange={draft.onChange}
          onValidityChange={setValid}
        />
        {params.entryMode === "pocket" && kit && plate && (
          <>
            <Field>
              <FieldLabel>Modeled MDF recess · candidate only</FieldLabel>
              <OptionSelect
                value=""
                options={[
                  {
                    value: "",
                    label:
                      "Choose a recess to inspect, or enter measurements above",
                  },
                  ...kit.facingEntryPockets.map((pocket, index) => ({
                    value: String(index),
                    label: pocket.name,
                  })),
                ]}
                onValueChange={(value) => {
                  if (value === "") return
                  const index = Number(value)
                  if (
                    !Number.isInteger(index) ||
                    index < 0 ||
                    index >= kit.facingEntryPockets.length
                  )
                    return
                  const pocket = kit.facingEntryPockets[index]
                  const next = {
                    ...params,
                    entryX:
                      pocket.xy[0] +
                      bedOffsetOf(plate.setup.anchors)[0] -
                      plate.setup.workOrigin[0],
                    entryY:
                      pocket.xy[1] +
                      bedOffsetOf(plate.setup.anchors)[1] -
                      plate.setup.workOrigin[1],
                    entryDiameter: pocket.diameter,
                    entryDepth: pocket.depth,
                    entryConfirmed: false,
                  }
                  setParams(next)
                  setValid(false)
                }}
              />
            </Field>
            <FieldDescription>
              The STEP model's screw recesses are Ø10 mm × 2 mm deep; the
              smaller through bore is Ø5.4 mm. Screws can reduce the usable
              depth. Choosing a candidate fills modeled dimensions; replace them
              with your measurements.
            </FieldDescription>
            <Button
              variant="outline"
              onClick={() => {
                const next = {
                  ...params,
                  x: kit.workAreaOrigin[0] - plate.setup.workOrigin[0],
                  y: kit.workAreaOrigin[1] - plate.setup.workOrigin[1],
                  width: kit.workArea[0],
                  depth: kit.workArea[1],
                  entryConfirmed: false,
                }
                setParams(next)
                setValid(false)
              }}
            >
              Use modeled XY travel as cutter-centre rectangle
            </Button>
          </>
        )}
        {pocketIssue && <FieldDescription>{pocketIssue}</FieldDescription>}
        <FieldDescription className="font-numeric">
          Diameter: {params.diameter} mm · Chip load:{" "}
          {tool && valid && chipLoad(tool, params) !== null
            ? `${chipLoad(tool, params)?.toFixed(4)} mm/tooth`
            : "Enter RPM, feed and flute count"}
          . Chip load = feed ÷ (RPM × cutting teeth); it is a calculation, not a
          suitability check.
        </FieldDescription>
        {tool && valid && (
          <ChipLoadCalculator
            tool={tool}
            params={params}
            onApply={(feed) => {
              const next = { ...params, feed }
              setParams(next)
              setValid(FacingParamsSchema.safeParse(next).success)
            }}
          />
        )}
        <Field>
          <FieldLabel htmlFor={presetNameId}>
            Save these cutting values as a preset
          </FieldLabel>
          <presetForm.Field name="name">
            {(field) => (
              <Input
                id={presetNameId}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                placeholder="Name for this cutter and material"
                maxLength={200}
              />
            )}
          </presetForm.Field>
        </Field>
        <Button
          variant="outline"
          disabled={!tool || !valid || !presetName.trim()}
          onClick={savePreset}
        >
          Save named cutting preset
        </Button>
        {!!operation && (
          <Button
            variant="outline"
            onClick={() =>
              openDialog({
                kind: "source",
                plateId: plateId!,
                operationId: operation.id,
              })
            }
          >
            View committed program
          </Button>
        )}
        {!valid && (
          <FieldDescription>
            Complete all numeric fields with valid cutting data. Invalid drafts
            cannot be applied.
          </FieldDescription>
        )}
        {!!operationId && operation?.revision !== revision && (
          <FieldDescription>
            This operation changed while the dialog was open. Reopen it to edit
            the current version.
          </FieldDescription>
        )}
      </FieldGroup>
    </AppDialog>
  )
}

function chipLoad(tool: Tool, params: FacingParams): number | null {
  const teeth = tool.flutes ?? tool.geometry.numberOfTeeth
  return teeth && teeth > 0 && params.rpm > 0
    ? params.feed / (params.rpm * teeth)
    : null
}
