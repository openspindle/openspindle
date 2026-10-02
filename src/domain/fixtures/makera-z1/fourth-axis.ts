import type { FixtureBounds, FixtureModel } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import { boxBottomPoints } from "@/domain/fixtures/mount-points"
import type { MountPoint } from "@/domain/fixtures/mount-points"
import { Fixture } from "../fixture"

/** Its rotation axis runs along X at this Y of its frame… */
const AXIS_Y = 19.630155
/** …and this height above its underside; its model's origin is on it. */
const AXIS_Z = 45

/**
 * The module as solid boxes in its frame, measured from its model to about a millimetre: the
 * motor beside the headstock, the headstock and its feet, the base and its two rails, the chuck,
 * the tailstock's quill over the base, and the tailstock and its feet. The stock is held along
 * the axis between the chuck's face (X −40.3) and the quill.
 */
const SOLIDS: readonly FixtureBounds[] = [
  { min: [-140.155, -51.37, 0], max: [-82, -8, 46] },
  { min: [-140.155, -8, 0], max: [-122, 41.5, 66] },
  { min: [-122, 1, 0], max: [-88, 38, 62.5] },
  { min: [-122, -6.5, 0], max: [-88, 46.5, 13] },
  { min: [-88, -6.5, 0], max: [140.155, 46.5, 3.5] },
  { min: [-88, -6.5, 0], max: [140.155, 3.5, 8.5] },
  { min: [-88, 36.5, 0], max: [140.155, 46.5, 8.5] },
  { min: [-88, -12, 0], max: [-40.3, 51.37, 76.71] },
  { min: [94, 12.6, 38], max: [109, 26.6, 52.5] },
  { min: [109, 1, 0], max: [126, 38, 62.5] },
  { min: [109, -6.5, 0], max: [126, 46.5, 13] },
]

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

  override get solids() {
    return SOLIDS
  }
}
