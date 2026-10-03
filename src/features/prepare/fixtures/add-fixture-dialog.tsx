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
import {
  useWorkspace,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { isBedKind } from "@/domain/fixtures/definitions"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import { plateLabel } from "@/domain/plate/plate"
import type { Plate } from "@/domain/plate/plate"
import { AppDialog } from "@/features/shell/app-dialog"
import { usePrepareSelection } from "../plate-tree/use-prepare-selection"
import { FixturePicture, modelSize } from "./fixture-picture"
import {
  FIXTURE_KIND_GROUPS,
  addFixtureToPlate,
  usePlateBedSetup,
} from "./plate-fixtures"

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

/** Compatible shared fixtures by kind, each added to the plate when chosen. */
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
      description={label}
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
 * Adds a compatible shared fixture, chosen by its picture among those of its kind: a
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
