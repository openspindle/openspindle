import { useState } from "react"
import { LocateFixed } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CoordinateInput } from "@/components/workspace/coordinate-input"
import { Hint } from "@/components/workspace/hint"
import { ReasonButton } from "@/components/workspace/reason-button"
import type { AnchorXY, StoredAnchor } from "@/domain/anchors/stored-anchors"
import { toMicrometre } from "@/domain/primitives"
import type { AnchorPosition } from "@/machine/contract"

/** Changing where the machine stores its anchors. */
export type AnchorWriting = {
  /** Why the machine's anchors cannot be written now; null when they can. */
  readonly reason: string | null
  readonly writing: boolean
  /** Where the machine is, in machine X and Y, to take as an anchor's position. */
  readonly current: AnchorXY | null
  /** Writes the positions; `done` runs once the machine stores them. */
  readonly onWrite: (anchors: AnchorPosition[], done: () => void) => void
}

const coordinateFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

/** One machine coordinate an edit changes, such as Anchor 1's X. */
type Change = { key: string; label: string; from: number; to: number }

function changesOf(
  anchors: readonly StoredAnchor[],
  positionOf: (anchor: StoredAnchor) => AnchorXY
): Change[] {
  return anchors.flatMap((anchor) =>
    (["X", "Y"] as const).flatMap((axis, index) => {
      const from = anchor.machinePosition[index]
      const to = positionOf(anchor)[index]
      if (toMicrometre(from) === toMicrometre(to)) return []
      return [
        {
          key: `${anchor.id}-${axis}`,
          label: `${anchor.name} ${axis}`,
          from,
          to,
        },
      ]
    })
  )
}

/**
 * The anchors' machine positions to write to the device: typed, or taken from where the machine
 * is. Writing asks for confirmation with what changes.
 */
export function AnchorPositionsForm({
  anchors,
  writing,
  onClose,
}: {
  anchors: readonly StoredAnchor[]
  writing: AnchorWriting
  onClose: () => void
}) {
  const [positions, setPositions] = useState<Record<string, AnchorXY>>(() =>
    Object.fromEntries(
      anchors.map((anchor) => [anchor.id, anchor.machinePosition])
    )
  )
  const [confirming, setConfirming] = useState(false)
  const positionOf = (anchor: StoredAnchor) =>
    positions[anchor.id] ?? anchor.machinePosition
  const place = (id: string, position: AnchorXY) =>
    setPositions((current) => ({ ...current, [id]: position }))
  const changes = changesOf(anchors, positionOf)
  const write = () => {
    setConfirming(false)
    writing.onWrite(
      anchors.map((anchor) => {
        const [x, y] = positionOf(anchor)
        return { id: anchor.id, x, y }
      }),
      onClose
    )
  }
  return (
    <>
      {anchors.map((anchor) => {
        const position = positionOf(anchor)
        return (
          <FieldSet key={anchor.id}>
            <FieldLegend>
              <Hint
                text={`${anchor.name} in machine coordinates, as the device stores it.`}
              >
                {anchor.name} on machine
              </Hint>
            </FieldLegend>
            <FieldGroup className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-3">
              {(["X", "Y"] as const).map((axis, index) => (
                <CoordinateInput
                  key={axis}
                  axis={axis}
                  unit="mm"
                  label={`${anchor.name} machine ${axis}`}
                  value={position[index]}
                  disabled={writing.writing}
                  onCommit={(value) => {
                    const next: AnchorXY = [...position]
                    next[index] = value
                    place(anchor.id, next)
                  }}
                />
              ))}
              <ReasonButton
                label={`Use the current position for ${anchor.name}`}
                variant="outline"
                size="icon"
                aria-label={`Use the current position for ${anchor.name}`}
                title={`Use the current position for ${anchor.name}`}
                reason={writing.reason}
                disabled={writing.writing || !writing.current}
                onClick={() => {
                  if (writing.current)
                    place(anchor.id, [
                      toMicrometre(writing.current[0]),
                      toMicrometre(writing.current[1]),
                    ])
                }}
              >
                <LocateFixed />
              </ReasonButton>
            </FieldGroup>
          </FieldSet>
        )
      })}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={writing.writing}
          onClick={onClose}
        >
          Cancel
        </Button>
        <ReasonButton
          label="Write to device"
          size="sm"
          reason={writing.reason}
          disabled={writing.writing || !changes.length}
          onClick={() => setConfirming(true)}
        >
          {writing.writing ? "Writing…" : "Write to device"}
        </ReasonButton>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Write the anchors to the device?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The machine keeps these positions in its configuration, and plates
              set against its anchors move with them.
            </AlertDialogDescription>
          </AlertDialogHeader>
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
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={write}>Write anchors</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
