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
import { profileDeviceId } from "@/domain/fixtures/profiles"
import {
  FIXTURE_LIMIT,
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
 * The fixtures of a bed setup of the device profile shown (`selectedId`), each edited in a
 * dialog. Adding one opens it there.
 */
export function DeviceFixtures({
  definitions,
  onChange,
  selectedId,
  bedSetupId,
}: {
  definitions: FixtureDefinition[]
  onChange: (definitions: FixtureDefinition[]) => void
  /** The profile they belong to. */
  selectedId: string
  /** The bed setup of it they belong to. */
  bedSetupId: string
}) {
  const edit = (definitionId: string) =>
    openDialog({
      kind: "fixture-definition",
      profileId: selectedId,
      bedSetupId,
      definitionId,
    })
  return (
    <Card size="sm" role="region" aria-label="Device fixtures">
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
            disabled={definitions.length >= FIXTURE_LIMIT}
            onClick={() => {
              const id = crypto.randomUUID()
              // New fixtures start in the middle of the machine's bed, on the top of the bed
              // new plates have, where the anchors are drawn too.
              const kit = kitForSetup({
                deviceId: profileDeviceId(selectedId),
                fixtures: definitions.map((definition) => ({ definition })),
              })
              const [x, y] = kit.bed.topCenter
              const top = fixtureSupportHeight(
                defaultFixtureInstances(definitions),
                kit.tableTop
              )
              onChange([
                ...definitions,
                {
                  id,
                  name: "New fixture",
                  kind: "clamp",
                  model: null,
                  color: "#a2aab3",
                  defaultEnabled: false,
                  defaultPosition: [x, y, top],
                  defaultRotation: [0, 0, 0],
                },
              ])
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
              key={`${selectedId}:${definition.id}`}
              definition={definition}
              onEdit={() => edit(definition.id)}
              onRemove={() =>
                onChange(
                  definitions.filter((item) => item.id !== definition.id)
                )
              }
            />
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
