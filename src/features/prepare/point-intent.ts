import type { Point3 } from "@/domain/primitives"
import type { PlateSetup } from "@/domain/plate/plate"
import { sameAnchorFrame } from "@/domain/anchors/stored-anchors"

/** Frozen model frame for a reviewed action; later model edits cannot silently move its target. */
export type PointIntent = {
  id: string
  plateId: string
  position: Point3
  setup: PlateSetup
  action: "xy" | "z" | "probe"
}

export function samePointSetup(a: PlateSetup, b: PlateSetup) {
  return (
    sameAnchorFrame(a.anchors, b.anchors) &&
    JSON.stringify({ ...a, anchors: null }) ===
      JSON.stringify({ ...b, anchors: null })
  )
}
