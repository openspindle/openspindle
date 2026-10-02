import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  ChevronDown,
  Copy,
  Lock,
  LockOpen,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Toggle } from "@/components/ui/toggle"
import { OptionSelect } from "@/components/option-select"
import { PointFields } from "@/components/workspace/coordinate-input"
import { FixtureOriginSelect } from "@/components/workspace/fixture-origin-select"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import type { ModelId } from "@/domain/models/model"
import type { Plate, PlateSetup } from "@/domain/plate/plate"
import type { FixturePatch } from "@/domain/plate/plate-fixtures"
import { setupItemKey } from "@/domain/plate/setup-items"
import type { SetupItemRef } from "@/domain/plate/setup-items"
import type { WorkspaceCommand } from "@/domain/workspace/workspace"
import { useModelLibrary } from "@/features/models/model-queries"
import { newId } from "@/domain/primitives"
import {
  FIXTURE_LIMIT,
  isBedKind,
  isLocked,
  libraryModelId,
  namedFixtures,
} from "@/domain/fixtures/definitions"
import type {
  FixtureDefinition,
  FixtureInstance,
} from "@/domain/fixtures/definitions"
import { selectSetupItem, useArrangeSelection } from "../arrange/arrange-state"
import { lockToggleCopy, toggleLock } from "../arrange/use-arrange-events"
import { addFixtureToPlate, usePlateBedSetup } from "../fixtures/plate-fixtures"
import { AnchorPlacementFields } from "./anchor-placement-fields"

const FIXTURE_ANCHOR_HINT =
  "Where the fixture sits: its origin, the point of its model chosen beside this, in bed coordinates from Anchor 1 or relative to another stored anchor."

/** What the panel says about a fixture's model, if anything (nothing while the library loads). */
function modelNote(
  definition: FixtureDefinition,
  library: ReadonlySet<ModelId> | null
) {
  if (!definition.model) return "No model attached"
  const id = libraryModelId(definition)
  if (id && library && !library.has(id))
    return "Its model is not in your Models library, so it shows as a box."
  return null
}

function ModelNote({
  definition,
  library,
}: {
  definition: FixtureDefinition
  library: ReadonlySet<ModelId> | null
}) {
  const note = modelNote(definition, library)
  return note ? <FieldDescription>{note}</FieldDescription> : null
}

const rowId = (plateId: string, item: SetupItemRef) =>
  `fixtures-${plateId}-${setupItemKey(item)}`

/**
 * Where a fixture sits, like the stock, but by its origin: the point it turns about, named beside
 * Anchor. Choosing another of its model's points as the origin leaves it where it is.
 */
function FixturePlacementFields({
  name,
  instance,
  setup,
  disabled,
  onPlace,
}: {
  name: string
  instance: FixtureInstance
  setup: PlateSetup
  disabled?: boolean
  onPlace: (patch: FixturePatch) => void
}) {
  const { model } = instance.definition
  return (
    <AnchorPlacementFields
      name={name}
      hint={FIXTURE_ANCHOR_HINT}
      point={
        model && (
          <FixtureOriginSelect
            name={name}
            model={model}
            disabled={disabled}
            onChoose={(origin) => onPlace({ origin })}
          />
        )
      }
      value={instance.position}
      relativeTo={instance.relativeTo}
      anchorSetup={setup.anchors}
      disabled={disabled}
      onChange={(position) => onPlace({ position })}
      onRelativeToChange={(relativeTo) => onPlace({ relativeTo })}
    />
  )
}

/** One thing on the plate's bed: its name opens its settings; its tools and Remove sit beside it. */
function BedRow({
  id,
  name,
  open,
  onOpenChange,
  onRemove,
  tools,
  children,
}: {
  id: string
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Absent while the item is locked: a locked fixture offers no Remove. */
  onRemove?: () => void
  tools?: ReactNode
  children: ReactNode
}) {
  return (
    <Collapsible id={id} open={open} onOpenChange={onOpenChange}>
      <Field orientation="horizontal">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="min-w-0 flex-1 justify-between px-0"
            />
          }
        >
          <span className="truncate">{name}</span>
          <ChevronDown data-icon="inline-end" />
        </CollapsibleTrigger>
        {tools}
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Remove from plate"
            aria-label={`Remove ${name} from plate`}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        )}
      </Field>
      <CollapsibleContent keepMounted className="pt-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Adds a fixture of the device's library as soon as it is chosen. */
function AddFixture({
  definitions,
  disabled,
  onAdd,
}: {
  definitions: readonly FixtureDefinition[]
  disabled: boolean
  onAdd: (value: string) => void
}) {
  const items = [
    { value: "", label: "Add fixture…" },
    ...definitions.map((definition) => ({
      value: definition.id,
      label: definition.name,
    })),
  ]
  return (
    <OptionSelect
      aria-label="Add fixture"
      className="w-full"
      options={items}
      value=""
      disabled={disabled}
      onValueChange={(value) => {
        if (value) onAdd(value)
      }}
    />
  )
}

/** The fixtures on the plate's bed, a wasteboard among them: each added and removed. */
export function PlateFixturesPanel({ plate }: { plate: Plate }) {
  const workspace = useWorkspaceStore()
  const setup = plate.setup
  const { definitions } = usePlateBedSetup(plate)
  const models = useModelLibrary().data
  const library = useMemo(
    () => (models ? new Set(models.map((model) => model.id)) : null),
    [models]
  )
  const run = (command: WorkspaceCommand) => {
    const result = workspace.dispatch(command)
    if (!result.ok) toast.error(result.error)
    return result
  }
  const update = (fixtureId: string, patch: FixturePatch) =>
    run({ type: "fixture.update", plateId: plate.id, fixtureId, patch })
  // What is selected in the viewer is open here; opening a row selects it there.
  const selection = useArrangeSelection()
  const selectedKey =
    selection?.plateId === plate.id ? setupItemKey(selection.item) : null
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (selection?.plateId === plate.id)
      document
        .getElementById(rowId(plate.id, selection.item))
        ?.scrollIntoView({ block: "nearest" })
  }, [plate.id, selection])
  const isOpen = (item: SetupItemRef) =>
    opened.has(setupItemKey(item)) || setupItemKey(item) === selectedKey
  const toggleOpen = (item: SetupItemRef, open: boolean, movable: boolean) => {
    const key = setupItemKey(item)
    setOpened((current) => {
      const next = new Set(current)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
    if (open) selectSetupItem({ plateId: plate.id, item }, movable)
    else if (key === selectedKey) selectSetupItem(null)
  }
  const placed = namedFixtures(setup.fixtures.filter((item) => item.enabled))
  const full = setup.fixtures.length >= FIXTURE_LIMIT
  const add = (value: string) => {
    const definition = definitions.find((item) => item.id === value)
    if (definition) addFixtureToPlate(workspace, plate.id, definition)
  }
  return (
    <FieldGroup className="min-w-0 p-4" role="tabpanel" aria-label="Fixtures">
      {placed.map(({ instance, name }) => {
        const locked = isLocked(instance)
        const bed = isBedKind(instance.definition.kind)
        const item = { kind: "fixture", id: instance.id } as const
        const lock = lockToggleCopy(locked)
        return (
          <BedRow
            key={instance.id}
            id={rowId(plate.id, item)}
            name={name}
            open={isOpen(item)}
            onOpenChange={(open) => toggleOpen(item, open, !bed && !locked)}
            onRemove={
              locked
                ? undefined
                : () =>
                    run({
                      type: "fixture.remove",
                      plateId: plate.id,
                      fixtureId: instance.id,
                    })
            }
            tools={
              !bed && (
                <Toggle
                  size="sm"
                  aria-label={`${lock.label} ${name}`}
                  title={lock.description}
                  pressed={locked}
                  onPressedChange={() =>
                    toggleLock(workspace, {
                      plate,
                      item: { ref: item, locked },
                    })
                  }
                >
                  {locked ? <Lock /> : <LockOpen />}
                </Toggle>
              )
            }
          >
            <FieldGroup>
              <ModelNote definition={instance.definition} library={library} />
              <FixturePlacementFields
                name={name}
                instance={instance}
                setup={setup}
                disabled={locked}
                onPlace={(patch) => update(instance.id, patch)}
              />
              <FieldSet>
                <FieldLegend>Rotation</FieldLegend>
                <PointFields
                  label={`${name} rotation`}
                  unit="°"
                  value={instance.rotation}
                  disabled={locked}
                  onChange={(rotation) => update(instance.id, { rotation })}
                />
              </FieldSet>
              <div className="flex items-center justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Reset placement"
                  aria-label={`Reset ${name} placement`}
                  disabled={locked}
                  onClick={() =>
                    update(instance.id, {
                      position: [...instance.definition.defaultPosition],
                      rotation: [...instance.definition.defaultRotation],
                      relativeTo: null,
                    })
                  }
                >
                  <RotateCcw data-icon="inline-start" />
                  Reset
                </Button>
                {!bed && (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Duplicate fixture"
                    aria-label={`Duplicate ${name}`}
                    disabled={full}
                    onClick={() =>
                      run({
                        type: "fixture.add",
                        plateId: plate.id,
                        fixture: { ...structuredClone(instance), id: newId() },
                      })
                    }
                  >
                    <Copy data-icon="inline-start" />
                    Duplicate
                  </Button>
                )}
              </div>
            </FieldGroup>
          </BedRow>
        )
      })}
      {!placed.length && (
        <FieldDescription>Nothing on this plate's bed yet.</FieldDescription>
      )}
      <AddFixture definitions={definitions} disabled={full} onAdd={add} />
    </FieldGroup>
  )
}
