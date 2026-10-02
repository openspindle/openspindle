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
import { selectedProfile } from "@/app/fixtures/fixture-library-store"
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
 * A fixture definition of a bed setup of the device profile the Device tab shows, edited as it
 * changes. It closes once the definition is gone, or another profile is shown.
 */
export function FixtureDefinitionDialog({
  dialog,
  onClose,
}: {
  dialog: Extract<WorkspaceDialog, { kind: "fixture-definition" }>
  onClose: () => void
}) {
  const fixtures = useFixtureLibraryStore()
  const definitions = useFixtureLibrary((library) =>
    library.selectedId === dialog.profileId
      ? (selectedProfile(library).bedSetups.find(
          (setup) => setup.id === dialog.bedSetupId
        )?.definitions ?? null)
      : null
  )
  const definition =
    definitions?.find((item) => item.id === dialog.definitionId) ?? null
  useEffect(() => {
    if (!definition) onClose()
  }, [definition, onClose])
  const library = useModelLibrary().data
  if (!definitions || !definition) return null
  const { id } = definition
  const update = (change: Partial<FixtureDefinition>) =>
    fixtures.setDefinitions(
      dialog.bedSetupId,
      withSingleDefaultBed(
        definitions.map((item) =>
          item.id === id ? { ...item, ...change } : item
        ),
        change.defaultEnabled || change.kind ? id : undefined
      )
    )
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
            kind={definition.kind}
            color={definition.color}
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
