import { useId, useState } from "react"
import type { ComponentType } from "react"
import { Copy, Plus, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FilePicker } from "@/components/file-picker"
import { ToolImage } from "@/components/workspace/tool-image"
import {
  createHolder,
  createPreset,
  defaultProbeProfile,
} from "@/domain/tools/tool"
import type { ProbeProfile, ToolSegment, ToolSource } from "@/domain/tools/tool"
import { OptionSelect } from "@/components/option-select"
import { toolKindLabel } from "./tool-format"
import type { Choice, ToolForm } from "./tool-form"
import { modelDataUrl } from "./tool-model-file"
import { photoDataUrl } from "./tool-photo"
import { PORTRAIT, ToolPicture } from "./tool-picture"

export const EDITOR_TABS = [
  "General",
  "Geometry",
  "Shaft",
  "Cutting presets",
  "Holder",
  "Post processor",
] as const
export type EditorTab = (typeof EDITOR_TABS)[number]

const TOOL_KINDS = [
  "flat end mill",
  "ball end mill",
  "bull nose end mill",
  "tapered mill",
  "tapered ball end mill",
  "chamfer mill",
  "drill",
  "center drill",
  "spot drill",
  "thread mill",
  "face mill",
  "slot mill",
  "radius mill",
  "engraving",
  "probe",
  "other",
]
const TOOL_MATERIALS = ["carbide", "HSS", "ceramics", "diamond", "PCD"]
const COATINGS = ["Uncoated", "TiN", "TiAlN", "AlTiN", "DLC", "Diamond"]
const COOLANTS = [
  "disabled",
  "flood",
  "mist",
  "through tool",
  "air",
  "air through tool",
  "suction",
]
const YES_NO: readonly Choice<boolean>[] = [
  { value: true, label: "Yes" },
  { value: false, label: "No" },
]
const HANDEDNESS: readonly Choice<"right" | "left">[] = [
  { value: "right", label: "Right hand" },
  { value: "left", label: "Left hand" },
]
const TAPERED_TIPS = ["flat", "ball", "bull nose"]
const PROBE_TOUCHES: readonly Choice<ProbeProfile["touch"]>[] = [
  { value: "z", label: "Z only" },
  { value: "xyz", label: "X, Y and Z" },
]
const TOUCHES_HINT =
  "What the stylus senses: touches along Z only, or in X, Y and Z, as a 3D touch probe does."
const POINTER_HINT =
  "Whether the probe carries a laser pointer, which traces without touching."
const EMPTY_SEGMENT: ToolSegment = {
  height: null,
  upperDiameter: null,
  lowerDiameter: null,
}

interface SectionProps {
  form: ToolForm
  /** The edited tool's import source, which is read-only. */
  source: ToolSource | null
}

/** A file the tool keeps, its photo or its 3D model: chosen from a file, or removed. */
function FileField({
  form,
  name,
  label,
  noun,
  accept,
  read,
}: {
  form: ToolForm
  name: "image" | "model"
  label: string
  /** What the buttons choose and remove. */
  noun: string
  accept: string
  /** The chosen file as the tool keeps it. */
  read: (file: File) => Promise<string>
}) {
  const id = useId()
  return (
    <form.Field name={name}>
      {(field) => (
        <Field className="col-span-full">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <div className="flex gap-2">
            <FilePicker
              accept={accept}
              aria-label={`${label} file`}
              onSelect={([file]) => {
                // Reading takes a moment: the file goes to the tool it was chosen for only.
                const toolId = form.state.values.id
                read(file).then(
                  (value) => {
                    if (form.state.values.id === toolId)
                      field.handleChange(value)
                  },
                  (error: unknown) =>
                    toast.error(
                      `${file.name} could not be read as a ${noun}.`,
                      {
                        description:
                          error instanceof Error ? error.message : undefined,
                      }
                    )
                )
              }}
            >
              {(open) => (
                <Button id={id} variant="outline" size="sm" onClick={open}>
                  Choose {noun}…
                </Button>
              )}
            </FilePicker>
            <Button
              variant="ghost"
              size="sm"
              disabled={field.state.value === null}
              onClick={() => field.handleChange(null)}
            >
              Remove {noun}
            </Button>
          </div>
        </Field>
      )}
    </form.Field>
  )
}

function GeneralSection({ form, source }: SectionProps) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:has-[>img]:grid-cols-[minmax(0,1fr)_130px]">
        <FieldGroup className="grid grid-cols-2 gap-4">
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" required wide />}
          </form.AppField>
          <form.AppField
            name="kind"
            listeners={{
              // Only a probe has a profile: a tool that becomes one starts with the default.
              onChange: ({ value }) => {
                const fresh = defaultProbeProfile(value)
                if ((fresh === null) !== (form.getFieldValue("probe") === null))
                  form.setFieldValue("probe", fresh)
              },
            }}
          >
            {(field) => (
              <field.TextField
                label="Tool type"
                required
                wide
                suggestions={TOOL_KINDS}
              />
            )}
          </form.AppField>
          <form.Subscribe selector={(state) => state.values.probe !== null}>
            {(profiled) =>
              profiled && (
                <>
                  <form.AppField name="probe.touch">
                    {(field) => (
                      <field.ChoiceField
                        label="Touches"
                        hint={TOUCHES_HINT}
                        choices={PROBE_TOUCHES}
                        required
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="probe.pointer">
                    {(field) => (
                      <field.ChoiceField
                        label="Laser pointer"
                        hint={POINTER_HINT}
                        choices={YES_NO}
                        required
                      />
                    )}
                  </form.AppField>
                </>
              )
            }
          </form.Subscribe>
          <form.AppField name="material">
            {(field) => (
              <field.TextField
                label="Tool material"
                suggestions={TOOL_MATERIALS}
              />
            )}
          </form.AppField>
          <form.AppField name="grade">
            {(field) => <field.TextField label="Grade" />}
          </form.AppField>
          <form.AppField name="coating">
            {(field) => (
              <field.TextField label="Coating" suggestions={COATINGS} />
            )}
          </form.AppField>
        </FieldGroup>
        <form.Subscribe selector={(state) => state.values}>
          {(draft) => <ToolImage tool={draft} />}
        </form.Subscribe>
      </div>
      <FieldGroup className="grid grid-cols-2 gap-4">
        <form.AppField name="vendor">
          {(field) => <field.TextField label="Vendor" />}
        </form.AppField>
        <form.AppField name="productId">
          {(field) => <field.TextField label="Product ID" />}
        </form.AppField>
        <form.AppField name="productLink">
          {(field) => (
            <field.TextField label="Product URL" wide maxLength={2048} />
          )}
        </form.AppField>
        <form.AppField name="vendorDescription">
          {(field) => <field.TextField label="Vendor description" wide />}
        </form.AppField>
        <form.AppField name="notes">
          {(field) => <field.TextAreaField label="Notes" />}
        </form.AppField>
        <FileField
          form={form}
          name="image"
          label="Product photo"
          noun="photo"
          accept="image/png,image/jpeg,image/webp"
          read={photoDataUrl}
        />
        <FileField
          form={form}
          name="model"
          label="3D model"
          noun="model"
          accept=".glb,model/gltf-binary"
          read={modelDataUrl}
        />
      </FieldGroup>
      {source?.fileName && (
        <FieldDescription>
          Source {source.fileName}
          {source.unit === "inches" && " · Converted from inches"}
        </FieldDescription>
      )}
    </>
  )
}

function GeometrySection({ form }: SectionProps) {
  return (
    <FieldGroup className="grid grid-cols-2 gap-4">
      <form.AppField name="diameter">
        {(field) => <field.NumberField label="Cutting diameter" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.maxDiameter">
        {(field) => <field.NumberField label="Maximum diameter" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.shankDiameter">
        {(field) => <field.NumberField label="Shank diameter" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.fluteLength">
        {(field) => <field.NumberField label="Flute length" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.overallLength">
        {(field) => <field.NumberField label="Overall length" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.bodyLength">
        {(field) => <field.NumberField label="Body length" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.shoulderLength">
        {(field) => <field.NumberField label="Shoulder length" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.shoulderDiameter">
        {(field) => <field.NumberField label="Shoulder diameter" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.assemblyGaugeLength">
        {(field) => (
          <field.NumberField label="Assembly gauge length" unit="mm" />
        )}
      </form.AppField>
      <form.AppField name="flutes">
        {(field) => <field.NumberField label="Flutes" integer />}
      </form.AppField>
      <form.AppField name="geometry.handedness">
        {(field) => (
          <field.ChoiceField label="Handedness" choices={HANDEDNESS} />
        )}
      </form.AppField>
      <form.AppField name="geometry.coolantThrough">
        {(field) => (
          <field.ChoiceField label="Through-tool coolant" choices={YES_NO} />
        )}
      </form.AppField>
      <form.AppField name="geometry.cornerRadius">
        {(field) => <field.NumberField label="Corner radius" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.upperRadius">
        {(field) => <field.NumberField label="Upper radius" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.tipDiameter">
        {(field) => <field.NumberField label="Tip diameter" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.tipLength">
        {(field) => <field.NumberField label="Tip length" unit="mm" />}
      </form.AppField>
      <form.AppField name="geometry.pointAngle">
        {(field) => (
          <field.NumberField label="Point angle" unit="°" max={180} />
        )}
      </form.AppField>
      <form.AppField name="geometry.taperAngle">
        {(field) => <field.NumberField label="Taper angle" unit="°" max={90} />}
      </form.AppField>
      <form.AppField name="geometry.taperedTip">
        {(field) => (
          <field.TextField label="Tapered tip" suggestions={TAPERED_TIPS} />
        )}
      </form.AppField>
      <form.AppField name="geometry.numberOfTeeth">
        {(field) => <field.NumberField label="Teeth" integer />}
      </form.AppField>
      <form.AppField name="geometry.threadPitchMin">
        {(field) => (
          <field.NumberField label="Minimum thread pitch" unit="mm" />
        )}
      </form.AppField>
      <form.AppField name="geometry.threadPitchMax">
        {(field) => (
          <field.NumberField label="Maximum thread pitch" unit="mm" />
        )}
      </form.AppField>
      <form.AppField name="geometry.threadProfileAngle">
        {(field) => (
          <field.NumberField label="Thread profile angle" unit="°" max={180} />
        )}
      </form.AppField>
      <form.AppField name="geometry.threadTip">
        {(field) => <field.TextField label="Thread tip" />}
      </form.AppField>
    </FieldGroup>
  )
}

function PresetFields({ form, index }: { form: ToolForm; index: number }) {
  const preset = `presets[${index}]` as const
  return (
    <FieldGroup className="grid grid-cols-2 gap-4">
      <form.AppField name={`${preset}.name`}>
        {(field) => <field.TextField label="Preset name" required />}
      </form.AppField>
      <form.AppField name={`${preset}.material`}>
        {(field) => <field.TextField label="Stock material" />}
      </form.AppField>
      <form.AppField name={`${preset}.description`}>
        {(field) => <field.TextField label="Preset description" wide />}
      </form.AppField>
      <form.AppField name={`${preset}.rpm`}>
        {(field) => <field.NumberField label="Spindle speed" unit="rpm" />}
      </form.AppField>
      <form.AppField name={`${preset}.rampRpm`}>
        {(field) => <field.NumberField label="Ramp spindle speed" unit="rpm" />}
      </form.AppField>
      <form.AppField name={`${preset}.cuttingSpeed`}>
        {(field) => <field.NumberField label="Cutting speed" unit="m/min" />}
      </form.AppField>
      <form.AppField name={`${preset}.rampAngle`}>
        {(field) => <field.NumberField label="Ramp angle" unit="°" max={180} />}
      </form.AppField>
      <form.AppField name={`${preset}.feedRate`}>
        {(field) => <field.NumberField label="Cutting feed" unit="mm/min" />}
      </form.AppField>
      <form.AppField name={`${preset}.plungeFeed`}>
        {(field) => <field.NumberField label="Plunge feed" unit="mm/min" />}
      </form.AppField>
      <form.AppField name={`${preset}.rampFeed`}>
        {(field) => <field.NumberField label="Ramp feed" unit="mm/min" />}
      </form.AppField>
      <form.AppField name={`${preset}.leadInFeed`}>
        {(field) => <field.NumberField label="Lead-in feed" unit="mm/min" />}
      </form.AppField>
      <form.AppField name={`${preset}.leadOutFeed`}>
        {(field) => <field.NumberField label="Lead-out feed" unit="mm/min" />}
      </form.AppField>
      <form.AppField name={`${preset}.transitionFeed`}>
        {(field) => <field.NumberField label="Transition feed" unit="mm/min" />}
      </form.AppField>
      <form.AppField name={`${preset}.retractFeed`}>
        {(field) => <field.NumberField label="Retract feed" unit="mm/min" />}
      </form.AppField>
      <form.AppField name={`${preset}.feedPerTooth`}>
        {(field) => (
          <field.NumberField label="Feed per tooth" unit="mm/tooth" />
        )}
      </form.AppField>
      <form.AppField name={`${preset}.feedPerRevolution`}>
        {(field) => (
          <field.NumberField label="Feed per revolution" unit="mm/rev" />
        )}
      </form.AppField>
      <form.AppField name={`${preset}.useFeedPerRevolution`}>
        {(field) => (
          <field.ChoiceField label="Use feed per revolution" choices={YES_NO} />
        )}
      </form.AppField>
      <form.AppField name={`${preset}.coolant`}>
        {(field) => <field.TextField label="Coolant" suggestions={COOLANTS} />}
      </form.AppField>
      <form.AppField name={`${preset}.stepover`}>
        {(field) => <field.NumberField label="Stepover" unit="mm" />}
      </form.AppField>
      <form.AppField name={`${preset}.useStepover`}>
        {(field) => <field.ChoiceField label="Use stepover" choices={YES_NO} />}
      </form.AppField>
      <form.AppField name={`${preset}.stepdown`}>
        {(field) => <field.NumberField label="Stepdown" unit="mm" />}
      </form.AppField>
      <form.AppField name={`${preset}.useStepdown`}>
        {(field) => <field.ChoiceField label="Use stepdown" choices={YES_NO} />}
      </form.AppField>
    </FieldGroup>
  )
}

function PresetsSection({ form }: SectionProps) {
  const [selected, setSelected] = useState(0)
  return (
    // Value mode (not array mode): the picker shows the presets' live names.
    <form.Field name="presets">
      {(presets) => {
        const list = presets.state.value
        const index = selected < list.length ? selected : 0
        const preset = list.at(index)
        const options = list.length
          ? list.map((item, position) => ({
              value: position,
              label: item.name,
            }))
          : [{ value: 0, label: "No presets" }]
        return (
          <>
            <div className="flex items-center gap-2">
              <OptionSelect
                aria-label="Cutting preset"
                className="min-w-0 flex-1"
                options={options}
                value={index}
                disabled={!list.length}
                onValueChange={setSelected}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  presets.pushValue(createPreset(list))
                  setSelected(list.length)
                }}
              >
                <Plus />
                Add
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Duplicate cutting preset"
                disabled={!preset}
                onClick={() => {
                  if (!preset) return
                  presets.pushValue({
                    ...structuredClone(preset),
                    id: crypto.randomUUID(),
                    name: `${preset.name} copy`,
                  })
                  setSelected(list.length)
                }}
              >
                <Copy />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete cutting preset"
                disabled={!preset}
                onClick={() => {
                  presets.removeValue(index)
                  setSelected(0)
                }}
              >
                <Trash2 />
              </Button>
            </div>
            {preset && <PresetFields key={index} form={form} index={index} />}
          </>
        )
      }}
    </form.Field>
  )
}

/** The holder's or the shaft's segments, stacked from the bottom up. */
function Segments({
  form,
  part,
}: {
  form: ToolForm
  part: "holder" | "shaft"
}) {
  return (
    <form.Field name={`${part}.segments`} mode="array">
      {(segments) => (
        <FieldSet>
          <FieldLegend>
            {part === "holder" ? "Holder segments" : "Shaft segments"}
          </FieldLegend>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => segments.pushValue(EMPTY_SEGMENT)}
            >
              <Plus />
              Add segment
            </Button>
          </div>
          {(segments.state.value ?? []).map((_, index) => (
            <FieldGroup
              key={index}
              className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-end gap-2"
            >
              <form.AppField name={`${part}.segments[${index}].height`}>
                {(field) => (
                  <field.NumberField label={`Height ${index + 1}`} unit="mm" />
                )}
              </form.AppField>
              <form.AppField name={`${part}.segments[${index}].upperDiameter`}>
                {(field) => (
                  <field.NumberField label={`Upper Ø ${index + 1}`} unit="mm" />
                )}
              </form.AppField>
              <form.AppField name={`${part}.segments[${index}].lowerDiameter`}>
                {(field) => (
                  <field.NumberField label={`Lower Ø ${index + 1}`} unit="mm" />
                )}
              </form.AppField>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${part} segment ${index + 1}`}
                onClick={() => segments.removeValue(index)}
              >
                <X />
              </Button>
            </FieldGroup>
          ))}
        </FieldSet>
      )}
    </form.Field>
  )
}

function ShaftSection({ form }: SectionProps) {
  return <Segments form={form} part="shaft" />
}

function HolderSection({ form }: SectionProps) {
  return (
    <form.Subscribe selector={(state) => state.values.holder !== null}>
      {(hasHolder) =>
        hasHolder ? (
          <>
            <FieldGroup className="grid grid-cols-2 gap-4">
              <form.AppField name="holder.name">
                {(field) => <field.TextField label="Holder name" />}
              </form.AppField>
              <form.AppField name="holder.vendor">
                {(field) => <field.TextField label="Holder vendor" />}
              </form.AppField>
              <form.AppField name="holder.productId">
                {(field) => <field.TextField label="Holder product ID" />}
              </form.AppField>
              <form.AppField name="holder.gaugeLength">
                {(field) => (
                  <field.NumberField label="Holder gauge length" unit="mm" />
                )}
              </form.AppField>
              <form.AppField name="holder.productLink">
                {(field) => (
                  <field.TextField
                    label="Holder product URL"
                    wide
                    maxLength={2048}
                  />
                )}
              </form.AppField>
            </FieldGroup>
            <Segments form={form} part="holder" />
            <Button
              variant="destructive"
              className="self-start"
              onClick={() => form.setFieldValue("holder", null)}
            >
              Remove holder
            </Button>
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No holder assigned</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => form.setFieldValue("holder", createHolder())}
              >
                <Plus data-icon="inline-start" />
                Add holder
              </Button>
            </EmptyContent>
          </Empty>
        )
      }
    </form.Subscribe>
  )
}

function PostProcessSection({ form }: SectionProps) {
  return (
    <FieldGroup className="grid grid-cols-2 gap-4">
      <form.AppField name="postProcess.number">
        {(field) => <field.NumberField label="Tool number" integer />}
      </form.AppField>
      <form.AppField name="postProcess.lengthOffset">
        {(field) => <field.NumberField label="Length offset" integer />}
      </form.AppField>
      <form.AppField name="postProcess.diameterOffset">
        {(field) => <field.NumberField label="Diameter offset" integer />}
      </form.AppField>
      <form.AppField name="postProcess.turret">
        {(field) => <field.NumberField label="Turret" integer />}
      </form.AppField>
      <form.AppField name="postProcess.manualToolChange">
        {(field) => (
          <field.ChoiceField label="Manual tool change" choices={YES_NO} />
        )}
      </form.AppField>
      <form.AppField name="postProcess.breakControl">
        {(field) => (
          <field.ChoiceField label="Break control" choices={YES_NO} />
        )}
      </form.AppField>
      <form.AppField name="postProcess.liveTool">
        {(field) => <field.ChoiceField label="Live tool" choices={YES_NO} />}
      </form.AppField>
      <form.AppField name="postProcess.comment">
        {(field) => <field.TextField label="Post comment" wide />}
      </form.AppField>
    </FieldGroup>
  )
}

const SECTIONS: Record<EditorTab, ComponentType<SectionProps>> = {
  General: GeneralSection,
  Geometry: GeometrySection,
  "Cutting presets": PresetsSection,
  Shaft: ShaftSection,
  Holder: HolderSection,
  "Post processor": PostProcessSection,
}

export interface ToolEditorProps {
  form: ToolForm
  /** Id of the editor's form element, for the dialog's submit button. */
  formId: string
  /** The edited tool's import source, which is read-only. */
  source: ToolSource | null
  tab: EditorTab
  onTabChange: (tab: EditorTab) => void
  /** The packaged catalog of an unchanged catalog tool, which is read-only. */
  catalogName: string | null
  dirty: boolean
  /** An import or export is running. */
  busy: boolean
  catalogsLoading: boolean
  canDelete: boolean
  onDuplicate: () => void
  onDelete: () => void
}

/** Header, tabs and fields of the tool being edited, as one form. */
export function ToolEditor({
  form,
  formId,
  source,
  tab,
  onTabChange,
  catalogName,
  dirty,
  busy,
  catalogsLoading,
  canDelete,
  onDuplicate,
  onDelete,
}: ToolEditorProps) {
  const locked = busy || catalogsLoading
  return (
    <>
      <Item>
        <ItemContent className="min-w-0">
          <form.Subscribe selector={(state) => state.values}>
            {(draft) => (
              <>
                <ItemTitle>
                  {draft.name || "Untitled tool"}
                  {dirty && <Badge variant="secondary">Unsaved</Badge>}
                </ItemTitle>
                <ItemDescription>
                  {draft.vendor ?? toolKindLabel(draft.kind)}
                  {draft.productId ? ` · ${draft.productId}` : ""}
                  {catalogName ? ` · ${catalogName} catalog` : " · My tools"}
                </ItemDescription>
              </>
            )}
          </form.Subscribe>
        </ItemContent>
        <ItemActions>
          <Button
            variant="ghost"
            size={catalogName ? "default" : "icon"}
            aria-label={catalogName ? "Copy to My tools" : "Duplicate tool"}
            disabled={locked}
            onClick={onDuplicate}
          >
            <Copy />
            {catalogName && "Copy to My tools"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete tool"
            disabled={locked || !canDelete}
            onClick={onDelete}
          >
            <Trash2 />
          </Button>
        </ItemActions>
      </Item>
      <form
        id={formId}
        noValidate
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = EDITOR_TABS.find((name) => name === value)
            if (next) onTabChange(next)
          }}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList
            variant="line"
            className="w-full shrink-0 justify-start px-3"
            aria-label="Tool parameters"
          >
            {EDITOR_TABS.map((name) => (
              <TabsTrigger key={name} value={name} disabled={busy}>
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
          {EDITOR_TABS.map((name) => {
            const Section = SECTIONS[name]
            return (
              <TabsContent
                key={name}
                value={name}
                className="flex min-h-0 items-start gap-5 overflow-y-auto p-5"
              >
                <FieldSet
                  className="min-w-0 flex-1"
                  disabled={locked || catalogName !== null}
                >
                  <FieldLegend className="sr-only">{name}</FieldLegend>
                  <Section form={form} source={source} />
                </FieldSet>
                <form.Subscribe selector={(state) => state.values}>
                  {(draft) => (
                    <ToolPicture tool={draft} framing="tool" size={PORTRAIT} />
                  )}
                </form.Subscribe>
              </TabsContent>
            )
          })}
        </Tabs>
      </form>
    </>
  )
}
