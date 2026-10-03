import { Box, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { kitForSetup } from "@/domain/fixtures/catalog"
import {
  bedSetupDefinitions,
  bedSetupOf,
  defaultFixtureProfile,
  profileDeviceId,
} from "@/domain/fixtures/profiles"
import { FIXTURE_CATALOG_LIMIT } from "@/domain/fixtures/compatibility"
import {
  useFixtureLibrary,
  useFixtureLibraryStore,
} from "@/app/fixtures/fixture-context"
import {
  defaultFixtureInstances,
  fixtureSupportHeight,
} from "@/domain/fixtures/definitions"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import {
  FixturePicture,
  modelSize,
} from "@/features/prepare/fixtures/fixture-picture"
import { openDialog } from "@/features/shell/dialogs"
import { FIXTURE_KINDS } from "./fixture-definition-dialog"

/** A fixture definition with its picture, its kind and size: choosing it edits it. */
function FixtureItem({
  definition,
  onEdit,
  onRemove,
}: {
  definition: FixtureDefinition
  onEdit: () => void
  onRemove: () => void
}) {
  const kind = FIXTURE_KINDS.find(([item]) => item === definition.kind)?.[1]
  return (
    <Item
      variant="muted"
      size="sm"
      className="relative flex-nowrap hover:bg-muted"
    >
      <ItemMedia>
        <FixturePicture definition={definition} className="w-16" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full">
          {/* The whole item edits it; the remove button stays above. */}
          <button
            type="button"
            className="min-w-0 truncate text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50"
            title={definition.name}
            onClick={onEdit}
          >
            {definition.name}
          </button>
        </ItemTitle>
        <ItemDescription className="truncate font-numeric">
          {definition.model
            ? `${kind} · ${modelSize(definition.model)} mm`
            : kind}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="relative">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${definition.name}`}
          title="Remove"
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </ItemActions>
    </Item>
  )
}

/**
 * The shared fixture library, with the selected bed setup as the context for default placement.
 * Every fixture remains available to edit, including ones for another kind of machine.
 */
export function DeviceFixtures({
  selectedId,
  bedSetupId,
}: {
  /** The profile whose bed defaults are edited. */
  selectedId: string
  /** The bed setup whose fixture defaults are edited. */
  bedSetupId: string
}) {
  const fixtures = useFixtureLibraryStore()
  const definitions = useFixtureLibrary((library) => library.definitions)
  const profiles = useFixtureLibrary((library) => library.profiles)
  const edit = (definitionId: string) =>
    openDialog({
      kind: "fixture-definition",
      profileId: selectedId,
      bedSetupId,
      definitionId,
    })
  return (
    <Card size="sm" role="region" aria-label="Fixture library">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Box className="size-4" />
          Fixtures
        </CardTitle>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Add fixture definition"
            disabled={definitions.length >= FIXTURE_CATALOG_LIMIT}
            onClick={() => {
              const id = crypto.randomUUID()
              const deviceId = profileDeviceId(selectedId)
              const profile = Object.hasOwn(profiles, selectedId)
                ? profiles[selectedId]
                : defaultFixtureProfile()
              const defaults = bedSetupDefinitions(
                definitions,
                bedSetupOf(profile, bedSetupId),
                deviceId
              )
              // New fixtures start in the middle of the machine's bed, on the top of the bed
              // new plates have, where the anchors are drawn too.
              const kit = kitForSetup({
                deviceId,
                fixtures: defaults.map((definition) => ({ definition })),
              })
              const [x, y] = kit.bed.topCenter
              const top = fixtureSupportHeight(
                defaultFixtureInstances(defaults),
                kit.tableTop
              )
              fixtures.addDefinition({
                id,
                name: "New fixture",
                kind: "clamp",
                model: null,
                color: "#a2aab3",
                defaultEnabled: false,
                defaultPosition: [x, y, top],
                defaultRotation: [0, 0, 0],
              })
              edit(id)
            }}
          >
            <Plus />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-2">
          {definitions.map((definition) => (
            <FixtureItem
              key={definition.id}
              definition={definition}
              onEdit={() => edit(definition.id)}
              onRemove={() => fixtures.removeDefinition(definition.id)}
            />
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
