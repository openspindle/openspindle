import { useId, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
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
import { withMovedAnchor } from "@/domain/anchors/stored-anchors"
import { toMicrometre } from "@/domain/primitives"
import { useMachineSnapshot, useWriteAnchors } from "@/platform/machine"

const coordinateFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

const FOLLOW_HINT =
  "The machine keeps its other anchors as offsets from the first, so they move with it unless they stay where they are."

/**
 * Keeps where a 3D probing found its corner or center as one of the connected device's anchors:
 * which one, and for the first whether the others move with it, then what changes, to confirm
 * before it is written to the device.
 */
export function SaveAsAnchor({
  position,
}: {
  /** The machine X and Y the probing found. */
  position: readonly [number, number]
}) {
  const id = useId()
  const machine = useMachineSnapshot()
  const writeAnchors = useWriteAnchors()
  const live = machine.anchors.value
  const [open, setOpen] = useState(false)
  const [anchorId, setAnchorId] = useState(live?.anchors[0]?.id ?? "")
  const [follow, setFollow] = useState(true)
  if (machine.features?.anchors === false || !live) return null
  const entry = machine.availability.writeAnchors
  const reason = entry.allowed ? null : (entry.reason ?? "Unavailable.")
  const chosen =
    live.anchors.find((anchor) => anchor.id === anchorId) ?? live.anchors[0]
  const first = chosen.id === live.anchors[0].id
  const others = live.anchors.slice(1).map((anchor) => anchor.name)
  const next = withMovedAnchor(
    live.anchors,
    chosen.id,
    [toMicrometre(position[0]), toMicrometre(position[1])],
    follow
  )
  const changes = live.anchors.flatMap((anchor, index) =>
    (["x", "y"] as const).flatMap((axis) => {
      const from = anchor[axis]
      const to = toMicrometre(next[index][axis])
      return toMicrometre(from) === to
        ? []
        : [
            {
              key: `${anchor.id}-${axis}`,
              label: `${anchor.name} ${axis.toUpperCase()}`,
              from,
              to,
            },
          ]
    })
  )
  const write = () =>
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
  return (
    <>
      <ReasonButton
        label="Save as anchor"
        variant="outline"
        size="sm"
        className="self-start"
        reason={reason}
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
              {first
                ? `The machine also places its tool setter and tool rack from ${chosen.name}, once it is reset.`
                : "The machine uses it once it is reset."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel htmlFor={`${id}-anchor`}>Anchor</FieldLabel>
              <OptionSelect
                id={`${id}-anchor`}
                className="ml-auto w-40"
                options={live.anchors.map((anchor) => ({
                  value: anchor.id,
                  label: anchor.name,
                }))}
                value={chosen.id}
                disabled={writeAnchors.isPending}
                onValueChange={setAnchorId}
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
                    Move {others.join(", ")} with it
                  </Hint>
                </FieldLabel>
              </Field>
            )}
          </FieldGroup>
          <Table className="font-numeric [&_td]:text-right [&_th:not(:first-child)]:text-right">
            <TableHeader>
              <TableRow>
                <TableHead>Anchor</TableHead>
                <TableHead>Machine · mm</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.map((change) => (
                <TableRow key={change.key}>
                  <TableHead scope="row">{change.label}</TableHead>
                  <TableCell>
                    {coordinateFormat.format(change.from)} →{" "}
                    {coordinateFormat.format(change.to)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={writeAnchors.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={writeAnchors.isPending || !changes.length}
              onClick={(event) => {
                // The dialog stays open until the machine stores them.
                event.preventDefault()
                write()
              }}
            >
              {writeAnchors.isPending ? "Writing…" : "Write anchors"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
