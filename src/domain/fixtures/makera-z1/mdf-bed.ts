import type { FixtureModel } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import { boxTopPoints, holePoints } from "@/domain/fixtures/mount-points"
import type { HoleXY, MountPoint } from "@/domain/fixtures/mount-points"
import { Fixture } from "../fixture"
import { Z1_DOWEL_HOLES } from "./z1-bed"

/** Counterbored M5 through holes: the aluminium bed's holes the MDF bed leaves open. */
const M5_HOLES: readonly HoleXY[] = [
  [-95.5, -18],
  [-92.5, 17],
  [-92.5, 56],
  [-92.5, 93],
  [-91, -58],
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
  [93, -92.5],
  [93, -60.5],
  [93, -23],
  [93, 20],
  [93, 56],
]

/**
 * The Z1's 6 mm MDF bed, laid on the aluminium bed with its dowel holes over the bed's pins.
 * Its frame is its STEP's: centred on the origin, its underside at Z 0.
 */
export class Z1MdfBed extends Fixture {
  readonly id = "z1-mdf-bed"
  readonly name = "Z1-MDF bed"
  readonly kind = "bed"
  readonly color = "#303332"
  override readonly defaultEnabled = true
  readonly defaultPosition: Point3 = [88, 88, -6]
  readonly model: FixtureModel = {
    source: { kind: "bundled", url: "/models/makera-z1-mdf-bed.glb" },
    bounds: { min: [-103, -103, 0], max: [103, 103, 6] },
    offset: [0, 0, 0],
  }
  /** Its top face's corners and centre, and its holes there. */
  readonly mountPoints: readonly MountPoint[] = [
    ...boxTopPoints(this.model.bounds),
    ...holePoints("m5", "M5 hole", M5_HOLES, this.model.bounds.max[2]),
    ...holePoints(
      "dowel",
      "Dowel hole",
      Z1_DOWEL_HOLES,
      this.model.bounds.max[2]
    ),
  ]
}
