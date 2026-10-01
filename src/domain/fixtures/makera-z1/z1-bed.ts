import type { FixtureBounds } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import { boxTopPoints, holePoints } from "@/domain/fixtures/mount-points"
import type { HoleXY, MountPoint } from "@/domain/fixtures/mount-points"
import { MachineBed } from "../machine-bed"

/*
 * Hole centres are the axes of the bed STEP's cylindrical faces (public/models/README.md), in
 * the STEP's own coordinates: millimetres, Z up, the bed centred on the origin.
 */

/** M5 threaded holes, on the bed's top face. */
const M5_HOLES: readonly HoleXY[] = [
  [-95.5, -85],
  [-95.5, -18],
  [-92.5, 17],
  [-92.5, 56],
  [-92.5, 93],
  [-91, -58],
  [-81, 18],
  [-81, 85],
  [-73, -95.5],
  [-69, -60.5],
  [-69, -23],
  [-69, 17],
  [-69, 56],
  [-69, 93],
  [-63, -13],
  [-58, -91],
  [-23, -60.5],
  [-23, -23],
  [-23, 20],
  [-23, 56],
  [-23, 93],
  [-18, -95.5],
  [-8, -85],
  [-8, -18],
  [-8, 18],
  [22, -92.5],
  [22, -60.5],
  [22, -23],
  [22, 20],
  [22, 56],
  [22, 93],
  [67, 93],
  [70, -92.5],
  [70, -60.5],
  [70, -23],
  [70, 20],
  [70, 56],
  [81, 18],
  [81, 85],
  [93, -92.5],
  [93, -60.5],
  [93, -23],
  [93, 20],
  [93, 56],
  [95.5, -85],
  [95.5, -18],
]

/** 4 mm dowel pin holes; the MDF bed has 5 mm holes over the same pins. */
export const Z1_DOWEL_HOLES: readonly HoleXY[] = [
  [-95.5, -7],
  [-83, -83],
  [-83, -38],
  [-83, 7],
  [-83, 57],
  [-38, -83],
  [-38, 7],
  [-38, 57],
  [-7, -95.5],
  [7, -83],
  [7, -38],
  [7, 7],
  [7, 57],
  [57, -83],
  [57, -38],
  [57, 7],
  [95.5, -7],
]

/**
 * The Z1's aluminium bed: its STEP moved by +88 mm in X and Y, so Anchor 1 (the L-bracket's inner
 * corner, 12 mm in from the 200 × 200 mm work area's front-left corner) is the origin. Its top is
 * 6 mm under the MDF bed's, which is Z 0.
 */
export class Z1Bed extends MachineBed {
  readonly modelUrl = "/models/makera-z1-bed.glb"
  readonly modelOrigin: Point3 = [88, 88, -6]
  readonly bounds: FixtureBounds = {
    min: [-15, -15, -16.2],
    max: [191, 191, -6],
  }
  readonly finish = { color: "#a9afb6", metalness: 0.48, roughness: 0.59 }
  readonly mountPoints: readonly MountPoint[] = [
    ...boxTopPoints(this.bounds),
    ...holePoints(
      "m5",
      "M5 hole",
      M5_HOLES,
      this.bounds.max[2],
      this.stepOnBed()
    ),
    ...holePoints(
      "dowel",
      "Dowel hole",
      Z1_DOWEL_HOLES,
      this.bounds.max[2],
      this.stepOnBed()
    ),
  ]

  /** Where the STEP's origin, which its holes are measured from, is on the bed. */
  private stepOnBed(): HoleXY {
    return [this.modelOrigin[0], this.modelOrigin[1]]
  }
}
