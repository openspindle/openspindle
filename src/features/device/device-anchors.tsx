import { useState } from "react"
import { CircleAlert, PencilLine, Waypoints } from "lucide-react"
import type { ReactNode } from "react"
import { bedAnchors } from "@/domain/anchors/stored-anchors"
import type {
  AnchorXY,
  StoredAnchorSetup,
} from "@/domain/anchors/stored-anchors"
import { CoordinateInput } from "@/components/workspace/coordinate-input"
import { Hint } from "@/components/workspace/hint"
import { ReasonButton } from "@/components/workspace/reason-button"
import {
  Card,
  CardAction,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card"
import {
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { AnchorPositionsForm } from "./anchor-positions-form"
import type { AnchorWriting } from "./anchor-positions-form"

/** Bed coordinates show three decimals, a micrometre, as every millimetre does. */
const coordinateFormat = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

const BED_OFFSET_HINT =
  "How far the bed and its holes sit from where the machine's kit places them from the first anchor. Only the 3D view uses it; the device is not changed."

/**
 * Where the machine's bed model sits from where its kit places it, from the first anchor, the
 * bed's origin. It aligns the bed's holes with the anchors for display only; it never writes the
 * firmware configuration.
 */
function BedOffset({
  offset,
  onAlign,
}: {
  offset: AnchorXY
  onAlign: (offset: AnchorXY) => void
}) {
  return (
    <FieldSet>
      <FieldLegend>
        <Hint text={BED_OFFSET_HINT}>Bed offset</Hint>
      </FieldLegend>
      <FieldGroup className="grid grid-cols-2 gap-3">
        <CoordinateInput
          axis="X"
          unit="mm"
          label="Bed offset X"
          value={offset[0]}
          onCommit={(value) => onAlign([value, offset[1]])}
        />
        <CoordinateInput
          axis="Y"
          unit="mm"
          label="Bed offset Y"
          value={offset[1]}
          onCommit={(value) => onAlign([offset[0], value])}
        />
      </FieldGroup>
    </FieldSet>
  )
}

export function DeviceAnchors({
  setup,
  loading,
  error,
  onAlign,
  action,
  writing,
}: {
  setup?: StoredAnchorSetup
  loading: boolean
  error?: string
  /** Moves the machine's bed from where its kit places it; absent when it cannot be edited. */
  onAlign?: (offset: AnchorXY) => void
  /** Shown in the header, such as reading the anchors again. */
  action?: ReactNode
  /** Changes the machine positions the device stores; absent when it stores none. */
  writing?: AnchorWriting
}) {
  const [editing, setEditing] = useState(false)
  if (!setup && !loading && !error && !action) return null
  let sourceLabel = setup ? "Defaults" : "Not read yet"
  if (setup?.source === "firmware-config") sourceLabel = "Device configuration"
  if (loading) sourceLabel = "Reading…"
  if (writing?.writing) sourceLabel = "Writing…"
  return (
    <Card
      size="sm"
      role="region"
      className="min-w-0"
      aria-label="Stored anchors"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Waypoints size={16} />
          Anchors
        </CardTitle>
        <CardDescription>{sourceLabel}</CardDescription>
        {(action || (writing && setup)) && (
          <CardAction className="flex gap-2">
            {writing && setup && (
              <ReasonButton
                label="Edit machine positions"
                variant="outline"
                size="sm"
                aria-label="Edit machine positions"
                reason={writing.reason}
                disabled={editing}
                onClick={() => setEditing(true)}
              >
                <PencilLine data-icon="inline-start" />
                Edit
              </ReasonButton>
            )}
            {action}
          </CardAction>
        )}
      </CardHeader>
      {setup && (
        <CardContent className="flex min-w-0 flex-col gap-4">
          <Table className="table-fixed font-numeric [&_td]:text-right [&_th:not(:first-child)]:text-right">
            <colgroup>
              <col />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-24" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>Anchor</TableHead>
                <TableHead>Machine X · mm</TableHead>
                <TableHead>Machine Y · mm</TableHead>
                <TableHead>Bed X · mm</TableHead>
                <TableHead>Bed Y · mm</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bedAnchors(setup).map((anchor, index) => {
                const [machineX, machineY] =
                  setup.anchors[index].machinePosition
                return (
                  <TableRow key={anchor.id}>
                    <TableHead scope="row" className="truncate">
                      <span
                        className="mr-2 inline-block size-1.5 rounded-full bg-orange-500"
                        aria-hidden="true"
                      />
                      {anchor.name}
                    </TableHead>
                    <TableCell>{coordinateFormat.format(machineX)}</TableCell>
                    <TableCell>{coordinateFormat.format(machineY)}</TableCell>
                    <TableCell>
                      {coordinateFormat.format(anchor.position[0])}
                    </TableCell>
                    <TableCell>
                      {coordinateFormat.format(anchor.position[1])}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {editing && writing && (
            <AnchorPositionsForm
              anchors={setup.anchors}
              writing={writing}
              onClose={() => setEditing(false)}
            />
          )}
          {onAlign && <BedOffset offset={setup.bedOffset} onAlign={onAlign} />}
        </CardContent>
      )}
      {error && (
        <CardContent>
          <FieldError className="flex items-start gap-2" title={error}>
            <CircleAlert
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              {error.startsWith("Timed out reading firmware")
                ? "Reading device anchors timed out."
                : error}
            </span>
          </FieldError>
        </CardContent>
      )}
    </Card>
  )
}
