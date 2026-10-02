import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type {
  ArrangeDrag,
  ArrangePick,
} from "@/components/workspace/bed-viewer"
import { MOVE_AXES_LABELS } from "@/domain/plate/setup-items"
import type { SetupItem } from "@/domain/plate/setup-items"
import { toMicrometre } from "@/domain/primitives"
import { useWorkspace } from "@/app/workspace/workspace-context"
import type { Operation } from "@/domain/operations/operation"
import {
  PROBE_3D_CORNER_LABELS,
  findsCorner,
} from "@/domain/probing/tasks/origin/params"
import { useArrange, useArrangeDrag } from "./arrange-state"
import type { ArrangeState, ArrangeTarget } from "./arrange-state"

const signed = (value: number) => {
  const rounded = toMicrometre(value)
  return rounded > 0 ? `+${rounded}` : String(rounded)
}

/** How far a drag has gone: the axes it moves along, and what it snapped to. */
function dragText({ delta, snappedTo }: ArrangeDrag) {
  const moved = (["X", "Y", "Z"] as const)
    .map((axis, index) => `${axis} ${signed(delta[index])}`)
    .join(", ")
  return snappedTo ? `${moved} mm, on ${snappedTo}` : `${moved} mm`
}

function hintText(
  item: SetupItem,
  state: ArrangeState,
  pick: ArrangePick,
  drag: ArrangeDrag | null
) {
  if (item.fixed) return item.fixed
  if (!state.moving) return "Move it with the move tool (M)."
  if (drag) return <span className="font-numeric">{dragText(drag)}</span>
  if (pick.from) return `Click the point to move ${pick.from.label} to.`
  if (pick.notice === "pick-own-point")
    return `First click a point of ${item.name}, then the point to align it to.`
  const along = MOVE_AXES_LABELS[state.axes]
  const snapping = state.snap ? ", snapping to points (hold Alt not to)" : ""
  return `Drag it along ${along}${snapping}, or click one of its points and then another. Right-click for options.`
}

/** What a point picked for a probing strategy snaps to (`pickTargets`). */
function snapTargets(strategy: string) {
  switch (strategy) {
    case "outside-corner":
      return "outer corners"
    case "inside-corner":
      return "inner corners"
    case "pocket-center":
      return "hole centres"
    case "boss-center":
      return "centres"
    default:
      return "corners and centres"
  }
}

/** What a click picks for an operation: where it starts, or which edges it traces. */
function pickingText(kind: "point" | "edges", operation: Operation | null) {
  if (kind === "edges")
    return "Click edges of the stock or fixtures to trace them, or click one again to drop it. Esc when done."
  const source = operation?.source
  const snapping = `snapping to ${snapTargets(source?.kind === "probing" ? source.strategy : "")}`
  if (source?.kind === "probing" && source.task === "origin") {
    const { routine, corner } = source.params
    // A corner snapped to is the one probed; a free pick probes the corner the operation has.
    return findsCorner(routine)
      ? `Click the corner to probe, ${snapping} (hold Alt to place it freely, as the ${PROBE_3D_CORNER_LABELS[corner].toLowerCase()} corner). Its start is set from there. Esc to cancel.`
      : `Click the centre to probe, ${snapping} (hold Alt to place it freely). Its start is set from there. Esc to cancel.`
  }
  const what =
    source?.kind === "probing" && source.task === "grid"
      ? "where the grid starts"
      : "where to touch"
  return `Click ${what}, ${snapping} (hold Alt to place it freely). Esc to cancel.`
}

/** What is selected in the viewer, and what clicking and dragging will do with it. */
export function ArrangeHint({
  target,
  pick,
}: {
  target: ArrangeTarget | null
  pick: ArrangePick
}) {
  const state = useArrange()
  const drag = useArrangeDrag()
  const { picking } = state
  const operation = useWorkspace(
    (workspace) =>
      (picking &&
        workspace.plates
          .find(({ id }) => id === picking.plateId)
          ?.operations.find(({ id }) => id === picking.operationId)) ??
      null
  )
  if (picking)
    return (
      <Card
        size="sm"
        className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-md max-w-[calc(100%-140px)] -translate-x-1/2"
        aria-live="polite"
      >
        <CardHeader>
          <CardTitle>{operation?.name ?? "Pick"}</CardTitle>
          <CardDescription>
            {pickingText(picking.kind, operation)}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  if (!target) return null
  return (
    <Card
      size="sm"
      className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-md max-w-[calc(100%-140px)] -translate-x-1/2"
      aria-live="polite"
    >
      <CardHeader>
        <CardTitle>{target.item.name}</CardTitle>
        <CardDescription>
          {hintText(target.item, state, pick, drag)}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}
