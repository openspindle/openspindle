import { boxModel } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import { boxMountPoints } from "@/domain/fixtures/mount-points"
import { Fixture } from "../fixture"

/**
 * A sacrificial MDF board for the stock to rest on, so cuts through the stock end in it. A
 * plain box, centred on the MDF bed by default.
 */
export class Z1MdfWasteboard extends Fixture {
  readonly id = "z1-mdf-wasteboard"
  readonly name = "MDF wasteboard"
  readonly kind = "wasteboard"
  readonly color = "#c7a477"
  readonly defaultPosition: Point3 = [88, 88, 0]
  readonly model = boxModel(100, 100, 2)
  readonly mountPoints = boxMountPoints(this.model.bounds)
}
