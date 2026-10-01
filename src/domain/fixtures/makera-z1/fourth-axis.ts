import type { FixtureModel } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import { boxBottomPoints } from "@/domain/fixtures/mount-points"
import type { MountPoint } from "@/domain/fixtures/mount-points"
import { Fixture } from "../fixture"

/** Its rotation axis runs along X at this Y of its frame… */
const AXIS_Y = 19.630155
/** …and this height above its underside; its model's origin is on it. */
const AXIS_Z = 45

/**
 * The Z1's 4th axis module, which turns the stock about X. Its frame centres its footprint, its
 * underside at Z 0; the axis is the centre of the chuck's and tailstock's turned surfaces.
 */
export class Z1FourthAxis extends Fixture {
  readonly id = "z1-fourth-axis"
  readonly name = "4th axis module"
  readonly kind = "rotary"
  readonly color = "#737b85"
  readonly defaultPosition: Point3 = [88, 88, 0]
  readonly model: FixtureModel = {
    source: { kind: "bundled", url: "/models/makera-z1-fourth-axis.glb" },
    bounds: {
      min: [-140.154941, -51.369846, 0],
      max: [140.154941, 51.369846, 76.709954],
    },
    offset: [-92.15494, AXIS_Y, AXIS_Z],
  }
  /** Its footprint, and where the stock is held on the axis. */
  readonly mountPoints: readonly MountPoint[] = [
    ...boxBottomPoints(this.model.bounds),
    {
      id: "chuck-face",
      name: "Chuck face",
      position: [-40.255, AXIS_Y, AXIS_Z],
    },
    {
      id: "tailstock-center",
      name: "Tailstock center",
      position: [93.038, AXIS_Y, AXIS_Z],
    },
  ]
}
