import { ChevronRight, Cpu } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card"
import { EmptyMedia } from "@/components/ui/empty"
import { Field, FieldLabel } from "@/components/ui/field"
import { OptionSelect } from "@/components/option-select"
import { useSelectedFixtureProfile } from "@/app/fixtures/fixture-context"
import {
  useSelectedPlate,
  useWorkspaceStore,
} from "@/app/workspace/workspace-context"
import { kitForDevice } from "@/domain/fixtures/catalog"
import { bedSetupOf } from "@/domain/fixtures/profiles"
import { openDialog } from "@/features/shell/dialogs"
import { fixtureInstance, isBedKind } from "@/domain/fixtures/definitions"
import type { FixtureDefinition } from "@/domain/fixtures/definitions"
import { useMachineSnapshot } from "@/platform/machine"

/** The connected machine at a glance; opens the device picker. */
export function DeviceCard() {
  const { device, restarting } = useMachineSnapshot().connection
  const imageUrl = device ? kitForDevice(device.model)?.imageUrl : undefined
  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-0">
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-3 p-3 text-left"
          onClick={() => openDialog({ kind: "device" })}
        >
          <EmptyMedia variant="icon" className="mb-0 size-12">
            {imageUrl ? (
              <img src={imageUrl} alt="" className="size-full object-contain" />
            ) : (
              <Cpu className="size-7" />
            )}
          </EmptyMedia>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CardTitle>
              {device?.name ?? (restarting ? "Restarting…" : "Connect device")}
            </CardTitle>
            {device && <CardDescription>{device.host}</CardDescription>}
          </div>
          <ChevronRight />
        </Button>
      </CardContent>
    </Card>
  )
}

/** The selected plate's bed: one of its bed setup's beds, or none. */
export function BedTypeField() {
  const workspace = useWorkspaceStore()
  const plate = useSelectedPlate()
  const { profile } = useSelectedFixtureProfile()
  const fixtures = plate?.setup.fixtures ?? []
  const definitions = [
    ...new Map(
      [
        ...bedSetupOf(profile, plate?.setup.bedSetupId).definitions.filter(
          (item) => isBedKind(item.kind)
        ),
        ...fixtures
          .filter((item) => isBedKind(item.definition.kind))
          .map((item) => item.definition),
      ].map((item): [string, FixtureDefinition] => [item.id, item])
    ).values(),
  ]
  const bed = fixtures.find(
    (item) => item.enabled && isBedKind(item.definition.kind)
  )
  const items = [
    { value: "", label: "None" },
    ...definitions.map((definition) => ({
      value: definition.id,
      label: definition.name,
    })),
  ]
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor="bed-type" className="shrink-0">
        Bed type
      </FieldLabel>
      <OptionSelect
        id="bed-type"
        aria-label="Bed type"
        className="min-w-0 flex-1"
        options={items}
        value={bed?.definition.id ?? ""}
        disabled={!plate}
        onValueChange={(value) => {
          if (!plate) return
          const definition = definitions.find((item) => item.id === value)
          // The plate keeps its own bed of that definition, if it has one.
          const result = workspace.dispatch({
            type: "fixture.setBed",
            plateId: plate.id,
            bed: definition ? fixtureInstance(definition) : null,
          })
          if (!result.ok) toast.error(result.error)
        }}
      />
    </Field>
  )
}
