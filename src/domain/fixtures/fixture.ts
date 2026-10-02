import type {
  FixtureBounds,
  FixtureDefinition,
  FixtureKind,
  FixtureModel,
} from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import type { MountPoint } from "@/domain/fixtures/mount-points"
import type { Finish } from "./machine-bed"

/**
 * A fixture OpenSpindle implements: what it is, how it is drawn, where a new plate puts it and
 * the points it mounts by. Each is a class of its own that holds its measurements. A profile
 * holds the definition it gives, which the user may rename or recolour, and each plate a
 * snapshot of that. Fixtures the user adds on the Device tab are definitions only.
 */
export abstract class Fixture {
  /** Profiles and plates refer to it by this id, so it never changes. */
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly kind: FixtureKind
  abstract readonly color: string
  /** Its model and frame (millimetres, Z up); its points and placement are in this frame. */
  abstract readonly model: FixtureModel
  /**
   * The points it mounts and lines up by, in its model's frame. Plates find a bundled model's
   * points here by the model, so corrections reach plates made before them.
   */
  abstract readonly mountPoints: readonly MountPoint[]
  /** Where a new plate puts it: its frame's origin on the bed, and its rotation in degrees. */
  abstract readonly defaultPosition: Point3
  readonly defaultRotation: Point3 = [0, 0, 0]
  /** Whether new plates have it. */
  readonly defaultEnabled: boolean = false
  /**
   * How shiny its model is drawn, in the colour its definition gives: plates find it by the
   * model, like its points. Null: as fixtures of its kind are drawn.
   */
  readonly finish: Omit<Finish, "color"> | null = null

  /**
   * The boxes it is solid in, in its model's frame, where its model's box also holds open space
   * a probe reaches into, such as an L-bracket's open corner or a clamp's slot. Plates find them
   * by the model, like its points. Null: its model's box.
   */
  get solids(): readonly FixtureBounds[] | null {
    return null
  }

  /** The definition a profile holds for it. */
  definition(): FixtureDefinition {
    return {
      id: this.id,
      name: this.name,
      kind: this.kind,
      color: this.color,
      defaultEnabled: this.defaultEnabled,
      defaultPosition: [...this.defaultPosition],
      defaultRotation: [...this.defaultRotation],
      model: structuredClone(this.model),
    }
  }
}
