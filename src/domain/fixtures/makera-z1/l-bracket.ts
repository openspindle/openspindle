import type { FixtureBounds, FixtureModel } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import { holePoints } from "@/domain/fixtures/mount-points"
import type { HoleXY, MountPoint } from "@/domain/fixtures/mount-points"
import { Fixture } from "../fixture"
import { MACHINED_ALUMINIUM } from "./aluminium"

/** Where the STEP's origin, which the holes are measured from, is in the brackets' frame. */
const STEP_ORIGIN: HoleXY = [103, 103]

/** Its dowel holes, over two of the bed's dowel pins, in the STEP's coordinates. */
const DOWEL_HOLES: readonly HoleXY[] = [
  [-95.5, -7],
  [-7, -95.5],
]

/** Its screw holes, over three of the MDF bed's M5 holes, in the STEP's coordinates. */
const SCREW_HOLES: readonly HoleXY[] = [
  [-95.5, -18],
  [-73, -95.5],
  [-18, -95.5],
]

/** How long and how wide each arm is. */
const ARM = { length: 100, width: 15 } as const

/**
 * The Z1's L-bracket, which stock is pushed into the inner corner of. Its frame starts at its
 * outer corner (its STEP moved by +103 mm); its points are on its underside, which rests on the
 * bed. The 15 mm arms put the inner corner, where the stock goes, at X 15, Y 15.
 */
abstract class Z1LBracket extends Fixture {
  readonly kind = "clamp"
  readonly color = MACHINED_ALUMINIUM.color
  override readonly finish = MACHINED_ALUMINIUM
  readonly defaultPosition: Point3 = [-15, -15, 0]
  readonly mountPoints: readonly MountPoint[] = [
    { id: "inner-corner", name: "Inner corner", position: [15, 15, 0] },
    { id: "outer-corner", name: "Outer corner", position: [0, 0, 0] },
    ...holePoints("dowel", "Dowel hole", DOWEL_HOLES, 0, STEP_ORIGIN),
    ...holePoints("screw", "Screw hole", SCREW_HOLES, 0, STEP_ORIGIN),
  ]
  /** Its bundled model. */
  protected abstract readonly modelUrl: string
  /** How tall its arms are, in millimetres. */
  protected abstract readonly height: number

  get model(): FixtureModel {
    return {
      source: { kind: "bundled", url: this.modelUrl },
      bounds: { min: [0, 0, 0], max: [ARM.length, ARM.length, this.height] },
      offset: [STEP_ORIGIN[0], STEP_ORIGIN[1], 0],
    }
  }

  /** Its two arms, along X at the front and along Y at the left, without its screw holes. */
  override get solids(): readonly FixtureBounds[] {
    return [
      { min: [0, 0, 0], max: [ARM.length, ARM.width, this.height] },
      { min: [0, ARM.width, 0], max: [ARM.width, ARM.length, this.height] },
    ]
  }
}

/** The 15 mm tall L-bracket. */
export class Z1LBracketThick extends Z1LBracket {
  readonly id = "z1-bracket-thick"
  readonly name = "L-bracket · thick"
  protected readonly modelUrl = "/models/makera-z1-bracket-thick.glb"
  protected readonly height = 15
}

/** The 5 mm tall L-bracket. */
export class Z1LBracketThin extends Z1LBracket {
  readonly id = "z1-bracket-thin"
  readonly name = "L-bracket · thin"
  protected readonly modelUrl = "/models/makera-z1-bracket-thin.glb"
  protected readonly height = 5
}
