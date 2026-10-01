import { useId, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { OptionSelect } from "@/components/option-select"
import { Hint } from "@/components/workspace/hint"
import { ReasonButton } from "@/components/workspace/reason-button"
import {
  useFixtureLibrary,
  useFixtureLibraryStore,
} from "@/app/fixtures/fixture-context"
import {
  profileAnchors,
  selectedProfile,
} from "@/app/fixtures/fixture-library-store"
import { followDeviceAnchors } from "@/app/workspace/project-session"
import { useWorkspaceStore } from "@/app/workspace/workspace-context"
import { withMovedAnchor } from "@/domain/anchors/stored-anchors"
import type { BedSetupAnchor } from "@/domain/anchors/stored-anchors"
import { WORKSPACE_PROFILE } from "@/domain/fixtures/profiles"
import type { Plate } from "@/domain/plate/plate"
import { toMicrometre } from "@/domain/primitives"
import { useMachineSnapshot, useWriteAnchors } from "@/platform/machine"

const coordinateFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

const FOLLOW_HINT =
  "The machine keeps its other anchors as offsets from the first, and bed setups keep theirs from it too, so they move with it unless they stay where they are."

/** A coordinate a save changes: from where it was, or nothing for a new anchor. */
type Change = { key: string; label: string; from: number | null; to: number }

const NEW_ANCHOR = "new"

/**
 * Keeps where a 3D probing found its corner or center as an anchor: one the connected device
 * stores, written to it (for the first, whether the others move with it), or one the plate's
 * bed setup keeps from the device's first anchor, or a new one there. What changes is shown to
 * confirm first.
 */
export function SaveAsAnchor({
  position,
  plate,
}: {
  /** The machine X and Y the probing found. */
  position: readonly [number, number]
  /** The plate the probing ran on, whose bed setup can keep the anchor. */
  plate: Plate
}) {
  const id = useId()
  const machine = useMachineSnapshot()
  const writeAnchors = useWriteAnchors()
  const fixtures = useFixtureLibraryStore()
  const workspace = useWorkspaceStore()
  const library = useFixtureLibrary((state) => state)
  const live = machine.anchors.value
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState(
    live?.anchors[0] ? `device:${live.anchors[0].id}` : ""
  )
  const [follow, setFollow] = useState(true)
  if (machine.features?.anchors === false || !live?.anchors.length) return null
  // The plate's bed setup, in its device's profile, which the Device tab shows and edits.
  const profileId = plate.setup.deviceId ?? WORKSPACE_PROFILE
  const bedSetup =
    profileId === library.selectedId &&
    Object.hasOwn(library.profiles, profileId)
      ? (library.profiles[profileId].bedSetups.find(
          (setup) => setup.id === plate.setup.bedSetupId
        ) ?? null)
      : null
  const entry = machine.availability.writeAnchors
  const writeReason = entry.allowed ? null : (entry.reason ?? "Unavailable.")
  const found: [number, number] = [
    toMicrometre(position[0]),
    toMicrometre(position[1]),
  ]
  const [origin] = live.anchors
  const deviceChoice = live.anchors.find(
    (anchor) => choice === `device:${anchor.id}`
  )
  const kept =
    bedSetup?.anchors.find((anchor) => choice === `bed:${anchor.id}`) ?? null
  const creating = !!bedSetup && choice === NEW_ANCHOR
  const chosen = deviceChoice ?? (kept || creating ? null : origin)
  const first = chosen?.id === origin.id
  const others = [
    ...live.anchors.slice(1).map((anchor) => anchor.name),
    ...(bedSetup?.anchors.length ? ["the bed setups' anchors"] : []),
  ]
  // A device anchor moves where it was found; the others follow the first unless they stay.
  const next = chosen
    ? withMovedAnchor(live.anchors, chosen.id, found, follow)
    : live.anchors
  // A bed setup's anchor is kept from the device's first anchor.
  const offset: [number, number] = [
    toMicrometre(found[0] - origin.x),
    toMicrometre(found[1] - origin.y),
  ]
  const newAnchor: BedSetupAnchor | null = creating
    ? {
        id: crypto.randomUUID(),
        name: `Anchor ${live.anchors.length + bedSetup.anchors.length + 1}`,
        offset,
      }
    : null
  let changes: Change[]
  if (chosen)
    changes = live.anchors.flatMap((anchor, index) =>
      (["x", "y"] as const).flatMap((axis): Change[] => {
        const to = toMicrometre(next[index][axis])
        return toMicrometre(anchor[axis]) === to
          ? []
          : [
              {
                key: `${anchor.id}-${axis}`,
                label: `${anchor.name} ${axis.toUpperCase()}`,
                from: anchor[axis],
                to,
              },
            ]
      })
    )
  else {
    const name = kept?.name ?? newAnchor?.name ?? ""
    changes = (["X", "Y"] as const).flatMap((axis, index): Change[] => {
      const from = kept ? kept.offset[index] : null
      return from !== null && toMicrometre(from) === offset[index]
        ? []
        : [
            {
              key: axis,
              label: `${name} ${axis} from ${origin.name}`,
              from,
              to: offset[index],
            },
          ]
    })
  }
  /** Plates set up for the profile's device follow its bed setups' anchors. */
  const followProfile = () => {
    const anchors = profileAnchors(
      fixtures.state.selectedId,
      selectedProfile(fixtures.state)
    )
    if (anchors) followDeviceAnchors(workspace, anchors)
  }
  const save = () => {
    if (chosen) {
      const moved = next.find((anchor) => anchor.id === origin.id) ?? origin
      const delta: [number, number] = [moved.x - origin.x, moved.y - origin.y]
      writeAnchors.mutate(
        {
          anchors: next.map((anchor) => ({
            id: anchor.id,
            x: toMicrometre(anchor.x),
            y: toMicrometre(anchor.y),
          })),
        },
        {
          onSuccess: ({ afterRestart }) => {
            // Bed setups' anchors stay where they are when the first moves without them.
            if (first && !follow && bedSetup) {
              fixtures.moveBedSetupAnchors([-delta[0], -delta[1]])
              followProfile()
            }
            setOpen(false)
            toast.success(`Saved as ${chosen.name}.`, {
              description: afterRestart
                ? "Reset the machine for its own moves to use it."
                : undefined,
            })
          },
          onError: (error) => toast.error(error.message),
        }
      )
      return
    }
    if (!bedSetup) return
    const anchors = kept
      ? bedSetup.anchors.map((anchor) =>
          anchor.id === kept.id ? { ...anchor, offset } : anchor
        )
      : newAnchor
        ? [...bedSetup.anchors, newAnchor]
        : bedSetup.anchors
    fixtures.setBedSetupAnchors(bedSetup.id, anchors)
    followProfile()
    setOpen(false)
    toast.success(
      `Saved as ${kept?.name ?? newAnchor?.name} of ${bedSetup.name}.`
    )
  }
  const confirmReason = chosen ? writeReason : null
  return (
    <>
      <ReasonButton
        label="Save as anchor"
        variant="outline"
        size="sm"
        className="self-start"
        reason={bedSetup ? null : writeReason}
        disabled={writeAnchors.isPending}
        onClick={() => setOpen(true)}
      >
        Save as anchor
      </ReasonButton>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save as an anchor?</AlertDialogTitle>
            <AlertDialogDescription>
              {chosen &&
                (first
                  ? `The machine also places its tool setter and tool rack from ${chosen.name}, once it is reset.`
                  : "The machine uses it once it is reset.")}
              {!chosen &&
                bedSetup &&
                `${bedSetup.name} keeps it from ${origin.name}; plates on it follow.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel htmlFor={`${id}-anchor`}>Anchor</FieldLabel>
              <OptionSelect
                id={`${id}-anchor`}
                className="ml-auto w-56"
                options={[
                  ...live.anchors.map((anchor) => ({
                    value: `device:${anchor.id}`,
                    label: anchor.name,
                  })),
                  ...(bedSetup
                    ? [
                        ...bedSetup.anchors.map((anchor) => ({
                          value: `bed:${anchor.id}`,
                          label: anchor.name,
                        })),
                        {
                          value: NEW_ANCHOR,
                          label: `New anchor in ${bedSetup.name}`,
                        },
                      ]
                    : []),
                ]}
                value={
                  chosen
                    ? `device:${chosen.id}`
                    : kept
                      ? `bed:${kept.id}`
                      : NEW_ANCHOR
                }
                disabled={writeAnchors.isPending}
                onValueChange={setChoice}
              />
            </Field>
            {first && others.length > 0 && (
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-follow`}
                  checked={follow}
                  disabled={writeAnchors.isPending}
                  aria-description={FOLLOW_HINT}
                  onCheckedChange={(checked) => setFollow(checked)}
                />
                <FieldLabel htmlFor={`${id}-follow`}>
                  <Hint text={FOLLOW_HINT}>
                    Move {others.join(" and ")} with it
                  </Hint>
                </FieldLabel>
              </Field>
            )}
          </FieldGroup>
          <Table className="font-numeric [&_td]:text-right [&_th:not(:first-child)]:text-right">
            <TableHeader>
              <TableRow>
                <TableHead>Anchor</TableHead>
                <TableHead>{chosen ? "Machine · mm" : "mm"}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.map((change) => (
                <TableRow key={change.key}>
                  <TableHead scope="row">{change.label}</TableHead>
                  <TableCell>
                    {change.from === null
                      ? "—"
                      : coordinateFormat.format(change.from)}{" "}
                    → {coordinateFormat.format(change.to)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={writeAnchors.isPending}>
              Cancel
            </AlertDialogCancel>
            <ReasonButton
              label={chosen ? "Write anchors" : "Save anchor"}
              reason={confirmReason}
              disabled={writeAnchors.isPending || !changes.length}
              onClick={save}
            >
              {writeAnchors.isPending
                ? "Writing…"
                : chosen
                  ? "Write anchors"
                  : "Save anchor"}
            </ReasonButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
