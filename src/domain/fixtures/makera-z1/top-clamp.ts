import type { FixtureModel } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import { holePoints } from "@/domain/fixtures/mount-points"
import type { HoleXY, MountPoint } from "@/domain/fixtures/mount-points"
import { Fixture } from "../fixture"
import { MACHINED_ALUMINIUM } from "./aluminium"

/** Where the STEP's origin, which the slot is measured from, is in the clamp's frame. */
const STEP_ORIGIN: HoleXY = [-32.5, -10]

/** The centres of the slot's round ends, in the STEP's coordinates turned Z up. */
const SLOT_ENDS: readonly HoleXY[] = [
  [9.5, 10],
  [55.5, 10],
]

/**
 * Makera's top clamp, a 65 × 20 × 5 mm plate screwed to the bed with an M5 screw through its
 * 46 mm slot. Its underside is a pad with a 2 mm wide step around it, 1 mm high at its +X end
 * and front and 3.5 mm high at its −X end and back: the pad stands beside the stock and a step
 * holds the stock's edge. Its frame centres its footprint, which is the slot's centre, on its
 * underside (its STEP turned Z up and moved by −32.5, −10 mm). Its points are the slot's
 * centres on the underside, and the middle of each step's inner edge, where the stock's top
 * edge goes.
 */
export class Z1TopClamp extends Fixture {
  readonly id = "z1-top-clamp"
  readonly name = "Top clamp"
  readonly kind = "clamp"
  readonly color = MACHINED_ALUMINIUM.color
  override readonly finish = MACHINED_ALUMINIUM
  /** On the MDF bed along its back edge, its slot centred on the rightmost M5 hole there. */
  readonly defaultPosition: Point3 = [155, 181, 0]
  readonly model: FixtureModel = {
    source: { kind: "bundled", url: "/models/makera-z1-top-clamp.glb" },
    bounds: { min: [-32.5, -10, 0], max: [32.5, 10, 5] },
    offset: [STEP_ORIGIN[0], STEP_ORIGIN[1], 0],
  }
  readonly mountPoints: readonly MountPoint[] = [
    { id: "slot-center", name: "Slot center", position: [0, 0, 0] },
    ...holePoints("slot-end", "Slot end", SLOT_ENDS, 0, STEP_ORIGIN),
    { id: "step-1mm-end", name: "1 mm step, end", position: [30.5, 0, 1] },
    { id: "step-1mm-side", name: "1 mm step, side", position: [0, -8, 1] },
    {
      id: "step-3.5mm-end",
      name: "3.5 mm step, end",
      position: [-30.5, 0, 3.5],
    },
    {
      id: "step-3.5mm-side",
      name: "3.5 mm step, side",
      position: [0, 8, 3.5],
    },
  ]
}
