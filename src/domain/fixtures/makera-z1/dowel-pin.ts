import type { FixtureModel } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import type { MountPoint } from "@/domain/fixtures/mount-points"
import { Fixture } from "../fixture"

/**
 * A 4 × 11 mm dowel pin in one of the bed's dowel holes: 7 mm below the surface it stands in
 * (the 6 mm MDF bed's top by default) and 4 mm proud of it, into a bracket's or another
 * fixture's pin holes. Its frame starts where it stands in that surface; its one point is its
 * centre there, which drops onto a dowel hole's.
 */
export class Z1DowelPin extends Fixture {
  readonly id = "z1-dowel-pin"
  readonly name = "Dowel pin · 4 × 11 mm"
  readonly kind = "other"
  readonly color = "#c3c8ce"
  readonly defaultPosition: Point3 = [-7.5, 81, 0]
  readonly model: FixtureModel = {
    source: { kind: "bundled", url: "/models/makera-z1-dowel-pin.glb" },
    bounds: { min: [-2, -2, -7], max: [2, 2, 4] },
    offset: [0, 0, -7],
  }
  readonly mountPoints: readonly MountPoint[] = [
    { id: "center", name: "Center", position: [0, 0, 0], feature: "pin" },
  ]
}
