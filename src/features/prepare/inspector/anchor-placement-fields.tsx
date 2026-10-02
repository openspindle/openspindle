import type { ReactNode } from "react"
import { FieldLegend, FieldSet } from "@/components/ui/field"
import { Hint } from "@/components/workspace/hint"
import { ReferencePointFields } from "@/components/workspace/reference-point-fields"
import {
  anchorReference,
  offsetFromAnchor,
  pointFromOffset,
} from "@/domain/plate/work-origin"
import type { Point3 } from "@/domain/primitives"
import { anchorDisplayName, bedAnchors } from "@/domain/anchors/stored-anchors"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"

type RelativePointFieldsProps = {
  /** What the point is, as accessible names say it: "{label} relative to", "{label} X". */
  label: string
  /** The point, in bed millimetres. */
  value: Point3
  /**
   * The stored anchor its X and Y are kept relative to; null or absent for bed coordinates, which
   * are from the first anchor.
   */
  relativeTo: string | null | undefined
  anchorSetup: StoredAnchorSetup | null
  disabled?: boolean
  /** Why Z is fixed, shown on its field; absent while Z can be edited. */
  zLock?: string
  onChange: (value: Point3) => void
  onRelativeToChange: (anchorId: string | null) => void
}

const AXES = ["X", "Y", "Z"] as const

/**
 * A point on the bed whose X and Y are offsets from one of the machine's stored anchors, which
 * it follows when the anchors change; Z stays on the bed. The first anchor is the bed's origin,
 * so a point kept relative to it is in bed coordinates. Choosing another reference leaves the
 * point where it is and shows its X and Y from there. Without stored anchors, it is a position
 * on the bed.
 */
export function RelativePointFields({
  label,
  value,
  relativeTo,
  anchorSetup,
  disabled,
  zLock,
  onChange,
  onRelativeToChange,
}: RelativePointFieldsProps) {
  const factory = anchorSetup?.source === "factory"
  const anchors = bedAnchors(anchorSetup ?? undefined)
  const origin = anchors.at(0)
  const others = anchors.slice(1)
  const references = [
    {
      value: "",
      label: origin ? `${origin.name} (bed origin)` : "Bed",
      axes: AXES,
    },
    ...others.map((anchor) => ({
      value: anchor.id,
      label: anchorDisplayName(anchor, factory),
      axes: AXES,
    })),
  ]
  const reference = anchorReference(anchorSetup, relativeTo)
  const [x, y, z] = offsetFromAnchor(value, reference)
  return (
    <ReferencePointFields
      label={label}
      references={references}
      reference={
        reference && reference.anchorId !== origin?.id ? reference.anchorId : ""
      }
      point={{ X: x, Y: y, Z: z }}
      locks={zLock === undefined ? {} : { Z: zLock }}
      disabled={disabled}
      onReferenceChange={(item) => onRelativeToChange(item || null)}
      onPointChange={({ X = x, Y = y, Z = z }) =>
        onChange(pointFromOffset([X, Y, Z], reference))
      }
    />
  )
}

type AnchorPlacementFieldsProps = Omit<RelativePointFieldsProps, "label"> & {
  /** What is placed, as accessible names say it: "{name} placement", "{name} anchor X". */
  name: string
  /** Which of its points the anchor is, as the legend's hint says it. */
  hint: string
  /** A control beside the legend that chooses that point, if it can be chosen. */
  point?: ReactNode
}

/**
 * Where something sits on the bed, by its anchor: one of its points (the stock's front-left
 * bottom corner, a fixture's origin), in bed coordinates or relative to a stored anchor.
 */
export function AnchorPlacementFields({
  name,
  hint,
  point,
  ...placement
}: AnchorPlacementFieldsProps) {
  return (
    <FieldSet aria-label={`${name} placement`}>
      <FieldLegend className="flex w-full items-center justify-between gap-3">
        <Hint text={hint}>Anchor</Hint>
        {point}
      </FieldLegend>
      <RelativePointFields label={`${name} anchor`} {...placement} />
    </FieldSet>
  )
}
