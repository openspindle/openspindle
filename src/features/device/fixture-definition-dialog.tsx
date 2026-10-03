import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { ColorField } from "@/components/color-field"
import { Hint } from "@/components/workspace/hint"
import {
  SURFACE_FINISHES,
  SURFACE_MATERIALS,
} from "@/domain/materials/surface-material"
import { OptionSelect } from "@/components/option-select"
import { NameField } from "@/components/name-field"
import {
  BoundedMeasurementInput,
  PointFieldSet,
  PointFields,
} from "@/components/workspace/coordinate-input"
import { FixtureOriginSelect } from "@/components/workspace/fixture-origin-select"
import { DIMENSION_AXES } from "@/components/workspace/measurement-input"
import {
  useFixtureLibrary,
  useFixtureLibraryStore,
} from "@/app/fixtures/fixture-context"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { definitionFinish } from "@/domain/fixtures/catalog"
import { profileDeviceId } from "@/domain/fixtures/profiles"
import { fail, normalizeText, ok } from "@/domain/primitives"
import {
  FIXTURE_NAME_LIMIT,
  boxModel,
  fixtureModelOf,
  libraryModelId,
  withBoxSize,
  withDefinitionOrigin,
  withSingleDefaultBed,
} from "@/domain/fixtures/definitions"
import type {
  FixtureDefinition,
  FixtureKind,
  FixtureModel,
} from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import { useModelLibrary } from "@/features/models/model-queries"
import { modelDetails } from "@/features/models/models-dialog"
import { AppDialog } from "@/features/shell/app-dialog"
import { openDialog } from "@/features/shell/dialogs"
import type { WorkspaceDialog } from "@/features/shell/dialogs"
import { FixtureOrientationField } from "./fixture-orientation-field"
import { MountPointsField } from "./mount-points-field"

/** A fixture without a material of its own is drawn as its model or its type is. */
const AUTOMATIC = "automatic"

const MATERIAL_HINT =
  "What it is made of, as it is drawn. Automatic draws a kit fixture as its model is, others as their type is: beds and wasteboards matte, the rest metal."

const MATERIAL_OPTIONS = [
  { value: AUTOMATIC, label: "Automatic" },
  ...SURFACE_MATERIALS.map((material) => ({
    value: material,
    label: SURFACE_FINISHES[material].label,
  })),
] as const

/** Fixture kinds, as they are named. */
export const FIXTURE_KINDS: Array<[FixtureKind, string]> = [
  ["bed", "Bed"],
  ["clamp", "Clamp"],
  ["holder", "Holder"],
  ["vise", "Vise"],
  ["vacuum-bed", "Vacuum bed"],
  ["wasteboard", "Wasteboard"],
  ["rotary", "Rotary module"],
  ["other", "Other"],
]
const NO_MODEL = ""
const BOX_MODEL = "box"
const BUNDLED_MODEL = "bundled"
const BOX_SIZE_LIMIT = 2000

/** A box the size of the model it replaces; a 50 mm square, 10 mm tall, without one. */
function replacementBox(model: FixtureModel | null) {
  if (!model) return boxModel(50, 50, 10)
  const { min, max } = model.bounds
  const [width, depth, height] = max.map((value, axis) =>
    Math.max(value - min[axis], 0.01)
  )
  return boxModel(width, depth, height)
}

/**
 * The model a fixture draws: a box, one from the Models library, or the one bundled with the
 * app.
 */
function FixtureModelField({
  definition,
  onChange,
  onModels,
}: {
  definition: FixtureDefinition
  onChange: (model: FixtureModel | null) => void
  /** Opens the Models library. */
  onModels: () => void
}) {
  const models = useModelLibrary().data ?? []
  const id = `fixture-model-${definition.id}`
  const source = definition.model?.source.kind
  const bundled = source === "bundled"
  const modelId = libraryModelId(definition)
  const selected = models.find((model) => model.id === modelId)
  let value = NO_MODEL
  if (bundled) value = BUNDLED_MODEL
  else if (source === "box") value = BOX_MODEL
  else if (modelId) value = modelId
  const items = [
    { value: NO_MODEL, label: "No model" },
    { value: BOX_MODEL, label: "Box" },
    ...(bundled ? [{ value: BUNDLED_MODEL, label: "Bundled model" }] : []),
    ...(modelId && !selected
      ? [{ value: modelId, label: "Missing model" }]
      : []),
    ...models.map((model) => ({ value: model.id, label: model.name })),
  ]
  let description = "Nothing is drawn for this fixture."
  if (bundled) description = "Bundled with OpenSpindle."
  else if (source === "box") description = "A box in the fixture's colour."
  else if (selected)
    description = modelDetails(selected, definition.model?.bounds)
  else if (modelId)
    description =
      "This model is not in your Models library, so the fixture shows as a box."
  return (
    <Field>
      <FieldLabel htmlFor={id}>Model</FieldLabel>
      <div className="flex gap-2">
        <OptionSelect
          options={items}
          value={value}
          onValueChange={(next) => {
            if (next === value || next === BUNDLED_MODEL) return
            if (next === BOX_MODEL) {
              onChange(replacementBox(definition.model))
              return
            }
            const model = models.find((item) => item.id === next)
            onChange(model ? fixtureModelOf(model) : null)
          }}
          id={id}
          aria-label={`Model for ${definition.name}`}
          className="min-w-0 flex-1"
        />
        <Button variant="outline" onClick={onModels}>
          Models…
        </Button>
      </div>
      <FieldDescription className="font-numeric">
        {description}
      </FieldDescription>
    </Field>
  )
}

/** A box model's size; its origin keeps its place in the box. */
function BoxSizeFields({
  definition,
  model,
  onChange,
}: {
  definition: FixtureDefinition
  model: FixtureModel
  onChange: (model: FixtureModel) => void
}) {
  const { min, max } = model.bounds
  const size = max.map((value, axis) => value - min[axis])
  return (
    <FieldSet>
      <FieldLegend>Size</FieldLegend>
      <FieldGroup className="gap-3">
        {(["width", "depth", "height"] as const).map((key, axis) => (
          <Field key={key}>
            <FieldLabel
              className="sr-only"
              htmlFor={`fixture-${key}-${definition.id}`}
            >
              {`${definition.name} ${key}`}
            </FieldLabel>
            <BoundedMeasurementInput
              id={`fixture-${key}-${definition.id}`}
              axis={DIMENSION_AXES[key]}
              unit="mm"
              label={`${definition.name} ${key}`}
              min={0.01}
              max={BOX_SIZE_LIMIT}
              value={size[axis]}
              onCommit={(value) => {
                const next = [...size] as Point3
                next[axis] = value
                onChange(withBoxSize(model, next))
              }}
            />
          </Field>
        ))}
      </FieldGroup>
    </FieldSet>
  )
}

/**
 * Where new plates put the fixture: the bed position of its origin, which it is positioned by
 * and turns about. Choosing another of its model's points as the origin leaves it where it is.
 */
function DefaultPositionFields({
  definition,
  onChange,
}: {
  definition: FixtureDefinition
  onChange: (change: Partial<FixtureDefinition>) => void
}) {
  const { model } = definition
  return (
    <FieldSet>
      <FieldLegend className="flex w-full items-center justify-between gap-3">
        <span>Default position</span>
        {model && (
          <FixtureOriginSelect
            name={definition.name}
            model={model}
            onChoose={(point) => {
              const framed = withDefinitionOrigin(definition, point)
              onChange({
                model: framed.model,
                defaultPosition: framed.defaultPosition,
              })
            }}
          />
        )}
      </FieldLegend>
      <PointFields
        label="Default position"
        unit="mm"
        value={definition.defaultPosition}
        onChange={(defaultPosition) => onChange({ defaultPosition })}
      />
    </FieldSet>
  )
}

/**
 * A fixture definition of a bed setup of a device's profile, edited as it changes: the plates
 * set up on that bed setup show it as it is edited. It closes once the definition is gone.
 */
export function FixtureDefinitionDialog({
  dialog,
  onClose,
}: {
  dialog: Extract<WorkspaceDialog, { kind: "fixture-definition" }>
  onClose: () => void
}) {
  const fixtures = useFixtureLibraryStore()
  const workspace = useWorkspaceStore()
  const profile = useFixtureLibrary((library) =>
    Object.hasOwn(library.profiles, dialog.profileId)
      ? library.profiles[dialog.profileId]
      : null
  )
  const definitions =
    profile?.bedSetups.find((setup) => setup.id === dialog.bedSetupId)
      ?.definitions ?? null
  const definition =
    definitions?.find((item) => item.id === dialog.definitionId) ?? null
  useEffect(() => {
    if (!definition) onClose()
  }, [definition, onClose])
  const library = useModelLibrary().data
  if (!definitions || !definition) return null
  const { id } = definition
  // The profile's definition, and the plates set up on its bed setup that have the fixture.
  const update = (change: Partial<FixtureDefinition>) => {
    const next = withSingleDefaultBed(
      definitions.map((item) =>
        item.id === id ? { ...item, ...change } : item
      ),
      change.defaultEnabled || change.kind ? id : undefined
    )
    fixtures.setDefinitions(dialog.bedSetupId, next, dialog.profileId)
    const changed = next.find((item) => item.id === id)
    if (changed)
      workspace.dispatch({
        type: "fixtures.redefine",
        deviceId: profileDeviceId(dialog.profileId),
        bedSetupId: dialog.bedSetupId,
        isDefault: profile?.defaultBedSetupId === dialog.bedSetupId,
        definition: changed,
      })
  }
  // The Models library model it draws, when the library has it: its preview turns it.
  const modelId = libraryModelId(definition)
  const previewed =
    modelId && library?.some((model) => model.id === modelId) ? modelId : null
  return (
    <AppDialog title={definition.name} onClose={onClose}>
      <FieldGroup>
        <FieldGroup className="grid grid-cols-2 gap-3">
          <NameField
            name={definition.name}
            maxLength={FIXTURE_NAME_LIMIT}
            onRename={(typed) => {
              const next = normalizeText(typed)
              if (!next) return fail("Enter a name.")
              update({ name: next })
              return ok(next)
            }}
          />
          <Field>
            <FieldLabel htmlFor={`fixture-kind-${definition.id}`}>
              Type
            </FieldLabel>
            <OptionSelect
              options={FIXTURE_KINDS.map(([kind, name]) => ({
                value: kind,
                label: name,
              }))}
              value={definition.kind}
              onValueChange={(value) => update({ kind: value })}
              id={`fixture-kind-${definition.id}`}
              aria-label="Fixture type"
              className="w-full"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`fixture-material-${definition.id}`}>
              <Hint text={MATERIAL_HINT}>Material</Hint>
            </FieldLabel>
            <OptionSelect
              options={MATERIAL_OPTIONS}
              value={definition.material ?? AUTOMATIC}
              onValueChange={(value) =>
                update({ material: value === AUTOMATIC ? undefined : value })
              }
              id={`fixture-material-${definition.id}`}
              aria-label="Fixture material"
              aria-description={MATERIAL_HINT}
              className="w-full"
            />
          </Field>
          <ColorField
            id={`fixture-color-${definition.id}`}
            label="Colour"
            value={definition.color}
            onChange={(color) => update({ color })}
          />
        </FieldGroup>
        <Field orientation="horizontal">
          <Switch
            id={`fixture-default-enabled-${definition.id}`}
            checked={definition.defaultEnabled}
            onCheckedChange={(checked) =>
              update({
                defaultEnabled: checked,
              })
            }
          />
          <FieldLabel htmlFor={`fixture-default-enabled-${definition.id}`}>
            Enabled on new plates
          </FieldLabel>
        </Field>
        <DefaultPositionFields
          definition={definition}
          onChange={(change) => update(change)}
        />
        <PointFieldSet
          label="Default rotation"
          unit="°"
          value={definition.defaultRotation}
          onChange={(defaultRotation) => update({ defaultRotation })}
        />
        <FixtureModelField
          definition={definition}
          onChange={(model) => update({ model })}
          onModels={() => openDialog({ kind: "models", back: dialog })}
        />
        {previewed && definition.model && (
          <FixtureOrientationField
            name={definition.name}
            color={definition.color}
            finish={definitionFinish(definition)}
            model={definition.model}
            modelId={previewed}
            onChange={(model) =>
              // It stands on the face chosen: only a turn about Z remains.
              update({
                model,
                defaultRotation: [0, 0, definition.defaultRotation[2]],
              })
            }
          />
        )}
        {definition.model?.source.kind === "box" && (
          <BoxSizeFields
            definition={definition}
            model={definition.model}
            onChange={(model) => update({ model })}
          />
        )}
        {definition.model && (
          <MountPointsField
            model={definition.model}
            onChange={(model) => update({ model })}
          />
        )}
      </FieldGroup>
    </AppDialog>
  )
}
