import type { FixtureBounds } from "@/domain/fixtures/definitions"
import type { Point3 } from "@/domain/nc/gcode"
import type { MountPoint } from "@/domain/fixtures/mount-points"

/** How a model's surfaces are drawn: base colour, and metalness and roughness from 0 to 1. */
export type Finish = {
  readonly color: string
  readonly metalness: number
  readonly roughness: number
}

/**
 * The bed a machine is built with, drawn under every plate, with the points fixtures mount to.
 * Bed coordinates are millimetres from the machine's first anchor (Anchor 1 on the Z1), with Z 0
 * where its kit puts it (the Z1's MDF bed top).
 */
export abstract class MachineBed {
  /** Its model, bundled with the app (glTF: metres, Y up). */
  abstract readonly modelUrl: string
  /** Where the model's origin is, in bed coordinates. */
  abstract readonly modelOrigin: Point3
  /** Its box, in bed coordinates. */
  abstract readonly bounds: FixtureBounds
  abstract readonly finish: Finish
  /** Its holes and corners, in bed coordinates. */
  abstract readonly mountPoints: readonly MountPoint[]

  /** The middle of its top face, in bed coordinates. */
  get topCenter(): Point3 {
    const { min, max } = this.bounds
    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, max[2]]
  }
}

/** A machine's bed moved in X and Y from where its kit has it, as a device's bed offset puts it. */
class MovedBed extends MachineBed {
  readonly modelUrl: string
  readonly modelOrigin: Point3
  readonly bounds: FixtureBounds
  readonly finish: Finish
  readonly mountPoints: readonly MountPoint[]

  constructor(bed: MachineBed, [dx, dy]: readonly [number, number]) {
    super()
    const moved = ([x, y, z]: readonly number[]): Point3 => [x + dx, y + dy, z]
    this.modelUrl = bed.modelUrl
    this.modelOrigin = moved(bed.modelOrigin)
    this.bounds = { min: moved(bed.bounds.min), max: moved(bed.bounds.max) }
    this.finish = bed.finish
    this.mountPoints = bed.mountPoints.map((point) => ({
      ...point,
      position: moved(point.position),
    }))
  }
}

const movedBeds = new WeakMap<MachineBed, Map<string, MachineBed>>()

/**
 * A kit's bed moved by `offset` in X and Y (`StoredAnchorSetup.bedOffset`); the bed itself when
 * it does not move. The same offset gives the same bed, so views keyed by it stay.
 */
export function bedAt(
  bed: MachineBed,
  offset: readonly [number, number]
): MachineBed {
  if (offset[0] === 0 && offset[1] === 0) return bed
  let beds = movedBeds.get(bed)
  if (!beds) movedBeds.set(bed, (beds = new Map()))
  const key = `${offset[0]},${offset[1]}`
  let moved = beds.get(key)
  if (!moved) beds.set(key, (moved = new MovedBed(bed, offset)))
  return moved
}
