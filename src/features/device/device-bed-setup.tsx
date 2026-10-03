import { LayoutTemplate, LocateFixed, Plus, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { NameField } from "@/components/name-field"
import { OptionSelect } from "@/components/option-select"
import { CoordinateInput } from "@/components/workspace/coordinate-input"
import { Hint } from "@/components/workspace/hint"
import { ReasonButton } from "@/components/workspace/reason-button"
import {
  BED_SETUP_ANCHOR_LIMIT,
  deviceAnchorsOf,
} from "@/domain/anchors/stored-anchors"
import type {
  AnchorXY,
  BedSetupAnchor,
  StoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import { BED_SETUP_LIMIT } from "@/domain/fixtures/profiles"
import type { BedSetup, FixtureProfiles } from "@/domain/fixtures/profiles"
import { fail, normalizeText, ok, toMicrometre } from "@/domain/primitives"

const BED_SETUP_HINT =
  "A way the device's bed is set up: its fixtures, which new plates start from, and anchors of its own. Plates on it follow its anchors."
const DEFAULT_HINT = "New plates for this device start on this bed setup."
const ANCHORS_HINT =
  "Points of this bed setup, such as a jig's corner, kept as X and Y from the device's first anchor, so they move with it. Placements and probing can start from them like from the device's anchors."

/** "Anchor N" with the first number from `first` that no anchor's name has. */
function nextAnchorName(
  first: number,
  anchors: readonly { readonly name: string }[]
) {
  const names = new Set(anchors.map((anchor) => anchor.name))
  let number = first
  while (names.has(`Anchor ${number}`)) number += 1
  return `Anchor ${number}`
}

/**
 * The project's device, and the bed setup of it whose fixture defaults it edits:
 * adding one (a copy of the shown one), naming, removing and making it the default for new
 * plates, and the anchors it keeps, each typed as X and Y from the device's first anchor or
 * taken from where the machine is.
 */
export function DeviceBedSetup({
  profiles,
  selectedId,
  onProfileChange,
  bedSetups,
  bedSetup,
  defaultBedSetupId,
  onBedSetupChange,
  deviceAnchors,
  current,
  onAdd,
  onRename,
  onRemove,
  onMakeDefault,
  onAnchorsChange,
}: {
  profiles: FixtureProfiles
  selectedId: string
  onProfileChange: (id: string) => void
  bedSetups: readonly BedSetup[]
  /** The bed setup shown. */
  bedSetup: BedSetup
  defaultBedSetupId: string
  onBedSetupChange: (id: string) => void
  /** The device's anchors; without them the bed setup keeps no anchors. */
  deviceAnchors: StoredAnchorSetup | undefined
  /** Where the machine is from the first anchor, to take as an anchor's; why not, otherwise. */
  current: { position: AnchorXY } | { reason: string }
  onAdd: () => void
  onRename: (name: string) => void
  onRemove: () => void
  onMakeDefault: () => void
  onAnchorsChange: (anchors: BedSetupAnchor[]) => void
}) {
  const available = Object.hasOwn(profiles, selectedId)
  const device = deviceAnchors ? deviceAnchorsOf(deviceAnchors) : []
  const first = device.at(0)
  const { anchors } = bedSetup
  const place = (id: string, change: Partial<BedSetupAnchor>) =>
    onAnchorsChange(
      anchors.map((anchor) =>
        anchor.id === id ? { ...anchor, ...change } : anchor
      )
    )
  const here =
    "position" in current
      ? ([
          toMicrometre(current.position[0]),
          toMicrometre(current.position[1]),
        ] as AnchorXY)
      : null
  const reason = "reason" in current ? current.reason : null
  return (
    <Card size="sm" role="region" aria-label="Bed setup">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutTemplate className="size-4" />
          <Hint text={BED_SETUP_HINT}>Bed setup</Hint>
        </CardTitle>
        {available && (
          <CardAction className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add bed setup"
              title="Add bed setup"
              disabled={bedSetups.length >= BED_SETUP_LIMIT}
              onClick={onAdd}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${bedSetup.name}`}
              title={`Remove ${bedSetup.name}`}
              disabled={bedSetups.length <= 1}
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="fixture-library-device">Device</FieldLabel>
            <OptionSelect
              id="fixture-library-device"
              aria-label="Project device"
              className="w-full"
              options={[
                ...(!available
                  ? [
                      {
                        value: selectedId,
                        label: `${selectedId} · Not on this computer`,
                        disabled: true,
                      },
                    ]
                  : []),
                ...Object.entries(profiles).map(([id, profile]) => ({
                  value: id,
                  label: profile.name,
                })),
              ]}
              value={selectedId}
              onValueChange={onProfileChange}
            />
          </Field>
          {available && (
            <>
              <Field>
                <FieldLabel htmlFor="device-bed-setup">Bed setup</FieldLabel>
                <OptionSelect
                  id="device-bed-setup"
                  className="w-full"
                  options={bedSetups.map((setup) => ({
                    value: setup.id,
                    label: setup.name,
                  }))}
                  value={bedSetup.id}
                  onValueChange={onBedSetupChange}
                />
              </Field>
              <NameField
                name={bedSetup.name}
                onRename={(typed) => {
                  const next = normalizeText(typed)
                  if (!next) return fail("Enter a name.")
                  onRename(next)
                  return ok(next)
                }}
              />
              <Field orientation="horizontal">
                <Checkbox
                  id="device-bed-setup-default"
                  checked={bedSetup.id === defaultBedSetupId}
                  disabled={bedSetup.id === defaultBedSetupId}
                  aria-description={DEFAULT_HINT}
                  onCheckedChange={(checked) => {
                    if (checked) onMakeDefault()
                  }}
                />
                <FieldLabel htmlFor="device-bed-setup-default">
                  <Hint text={DEFAULT_HINT}>Default for new plates</Hint>
                </FieldLabel>
              </Field>
              {first && (
                <FieldSet>
                  <FieldLegend className="flex w-full items-center justify-between">
                    <Hint text={ANCHORS_HINT}>Anchors from {first.name}</Hint>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Add anchor"
                      title="Add anchor"
                      disabled={anchors.length >= BED_SETUP_ANCHOR_LIMIT}
                      onClick={() =>
                        onAnchorsChange([
                          ...anchors,
                          {
                            id: crypto.randomUUID(),
                            name: nextAnchorName(device.length + 1, [
                              ...device,
                              ...anchors,
                            ]),
                            offset: here ?? [0, 0],
                          },
                        ])
                      }
                    >
                      <Plus />
                    </Button>
                  </FieldLegend>
                  {anchors.map((anchor) => (
                    <FieldGroup
                      key={anchor.id}
                      className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] items-end gap-2"
                    >
                      <NameField
                        name={anchor.name}
                        label="Anchor name"
                        hideLabel
                        onRename={(typed) => {
                          const next = normalizeText(typed)
                          if (!next) return fail("Enter a name.")
                          place(anchor.id, { name: next })
                          return ok(next)
                        }}
                      />
                      <CoordinateInput
                        axis="X"
                        unit="mm"
                        label={`${anchor.name} X from ${first.name}`}
                        value={anchor.offset[0]}
                        onCommit={(value) =>
                          place(anchor.id, {
                            offset: [value, anchor.offset[1]],
                          })
                        }
                      />
                      <CoordinateInput
                        axis="Y"
                        unit="mm"
                        label={`${anchor.name} Y from ${first.name}`}
                        value={anchor.offset[1]}
                        onCommit={(value) =>
                          place(anchor.id, {
                            offset: [anchor.offset[0], value],
                          })
                        }
                      />
                      <ReasonButton
                        label={`Use the current position for ${anchor.name}`}
                        variant="outline"
                        size="icon"
                        aria-label={`Use the current position for ${anchor.name}`}
                        title={`Use the current position for ${anchor.name}`}
                        reason={reason}
                        onClick={() => {
                          if (here) place(anchor.id, { offset: here })
                        }}
                      >
                        <LocateFixed />
                      </ReasonButton>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${anchor.name}`}
                        title={`Remove ${anchor.name}`}
                        onClick={() =>
                          onAnchorsChange(
                            anchors.filter((item) => item.id !== anchor.id)
                          )
                        }
                      >
                        <X />
                      </Button>
                    </FieldGroup>
                  ))}
                </FieldSet>
              )}
            </>
          )}
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
