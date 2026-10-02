import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { isBedKind } from "@/domain/fixtures/definitions"
import type {
  FixtureDefinition,
  FixtureModel,
} from "@/domain/fixtures/definitions"
import { plateLabel } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import { AppDialog } from "@/features/shell/app-dialog"
import { usePrepareSelection } from "../plate-tree/use-prepare-selection"
import { FIXTURE_ICONS } from "./fixture-icon"
import { useFixtureThumbnail } from "./fixture-thumbnails"
import {
  FIXTURE_KIND_GROUPS,
  addFixtureToPlate,
  usePlateBedSetup,
} from "./plate-fixtures"

/** A model's box as width × depth × height, in millimetres. */
function modelSize({ bounds: { min, max } }: FixtureModel) {
  return max
    .map((value, axis) =>
      (value - min[axis]).toLocaleString("en-US", {
        useGrouping: false,
        maximumFractionDigits: 1,
      })
    )
    .join(" × ")
}

/** The fixture's model as a picture, its kind's icon without one, a placeholder while drawn. */
function FixturePicture({ definition }: { definition: FixtureDefinition }) {
  return (
    <div className="grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-sm bg-muted/40">
      <PictureContent definition={definition} />
    </div>
  )
}

function PictureContent({ definition }: { definition: FixtureDefinition }) {
  const picture = useFixtureThumbnail(definition)
  if (picture === undefined) return <Skeleton className="size-full" />
  if (picture === null) {
    const Icon = FIXTURE_ICONS[definition.kind]
    return <Icon className="size-8 text-muted-foreground" aria-hidden />
  }
  return (
    <img
      className="size-full object-contain"
      src={picture}
      alt=""
      draggable={false}
    />
  )
}

/** A fixture to add, as a card with its picture: its name, its size and how many the plate has. */
function FixtureChoice({
  definition,
  placed,
  title,
  onSelect,
}: {
  definition: FixtureDefinition
  /** How many of it the plate has. */
  placed: number
  title?: string
  onSelect: () => void
}) {
  return (
    <Item
      variant="outline"
      render={<button type="button" />}
      className="flex-col items-stretch gap-2 p-2 text-left hover:bg-muted/50"
      aria-label={`Add ${definition.name}`}
      title={title}
      onClick={onSelect}
    >
      <FixturePicture definition={definition} />
      <ItemContent className="min-w-0 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <ItemTitle
            className="min-w-0 flex-1 truncate"
            title={definition.name}
          >
            {definition.name}
          </ItemTitle>
          {placed > 0 && (
            <Badge variant="secondary" className="font-numeric">
              {placed > 1 ? `${placed} on plate` : "On plate"}
            </Badge>
          )}
        </div>
        <ItemDescription className="truncate font-numeric">
          {definition.model ? `${modelSize(definition.model)} mm` : "No model"}
        </ItemDescription>
      </ItemContent>
    </Item>
  )
}

/** The plate's bed setup's fixtures by kind, each added to the plate when chosen. */
function FixtureChoices({
  plate,
  label,
  onClose,
}: {
  plate: Plate
  label: string
  onClose: () => void
}) {
  const workspace = useWorkspaceStore()
  const selection = usePrepareSelection()
  const bedSetup = usePlateBedSetup(plate)
  const placed = (definition: FixtureDefinition) =>
    plate.setup.fixtures.filter(
      (item) => item.enabled && item.definition.id === definition.id
    ).length
  const add = (definition: FixtureDefinition) => {
    if (!addFixtureToPlate(workspace, plate.id, definition)) return
    // The new fixture's settings show, where it is placed.
    selection.showPlateSetup(plate.id, "fixtures")
    onClose()
  }
  return (
    <AppDialog
      title="Add fixture"
      description={`${label} · ${bedSetup.name}`}
      width="wide"
      onClose={onClose}
    >
      {bedSetup.definitions.length ? (
        <div className="flex flex-col gap-4">
          {FIXTURE_KIND_GROUPS.map(([kind, group]) => {
            const definitions = bedSetup.definitions.filter(
              (definition) => definition.kind === kind
            )
            if (!definitions.length) return null
            return (
              <section
                key={kind}
                aria-label={group}
                className="flex flex-col gap-2"
              >
                <h3 className="text-muted-foreground">{group}</h3>
                <ItemGroup className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {definitions.map((definition) => (
                    <FixtureChoice
                      key={definition.id}
                      definition={definition}
                      placed={placed(definition)}
                      title={
                        isBedKind(kind) ? `Replaces ${label}'s bed` : undefined
                      }
                      onSelect={() => add(definition)}
                    />
                  ))}
                </ItemGroup>
              </section>
            )
          })}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No fixtures to add</EmptyTitle>
            <EmptyDescription>
              Fixtures are defined on the Device tab.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </AppDialog>
  )
}

/**
 * Adds a fixture of the plate's bed setup, chosen by its picture among those of its kind: a
 * bed replaces the plate's bed. The fixture added is selected, to be moved into place.
 */
export function AddFixtureDialog({
  plateId,
  onClose,
}: {
  plateId: string
  onClose: () => void
}) {
  const plates = useWorkspace((state) => state.plates)
  const index = plates.findIndex((plate) => plate.id === plateId)
  // A plate removed meanwhile closes its dialog (`useCloseOrphanedDialog`).
  if (index < 0) return null
  const plate = plates[index]
  return (
    <FixtureChoices
      plate={plate}
      label={plateLabel(plate, index)}
      onClose={onClose}
    />
  )
}
