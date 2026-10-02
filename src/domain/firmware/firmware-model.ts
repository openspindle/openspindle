import type { GCodeFirmware, Point3 } from "@/domain/nc/gcode"
import type { StoredAnchorSetup } from "@/domain/anchors/stored-anchors"
import type { Solid } from "@/domain/fixtures/solids"

/**
 * Where a plate is on its machine, as its firmware's moves are placed in the plate's work
 * coordinates: machine X and Y through the anchors, and what probing touches.
 */
export type FirmwareSetup = {
  /** Machine X and Y on the bed: the plate's anchors, else its machine's factory ones. */
  readonly anchors: StoredAnchorSetup
  /** The plate's work origin on the bed, where the preview's coordinates start. */
  readonly workOrigin: Point3
  /** The stock's box on the bed; null without stock. */
  readonly stock: { readonly min: Point3; readonly max: Point3 } | null
  /** Bed Z of what carries the stock, the plate's bed or wasteboard: where probing off the stock touches. */
  readonly supportZ: number
  /**
   * Where the plate's enabled fixtures but its bed are solid on the bed (`fixtureSolids`), which
   * probing meets besides the stock and what carries it.
   */
  readonly solids: readonly Solid[]
}

/**
 * How a kind of machine's firmware moves for the codes the preview leaves to it: machine
 * coordinates, probing routines and tool changes, from its source.
 */
export interface FirmwareModel {
  /** The firmware as the preview follows it, for one parse of a plate set up on the machine. */
  preview: (setup: FirmwareSetup) => GCodeFirmware
  /**
   * Where the tip of the tool work Z was set with is on the plate's bed at a machine position,
   * as the preview places the firmware's moves.
   */
  bedPosition: (setup: FirmwareSetup, machine: Point3) => Point3
  /** The machine position at which that tool's tip is at a point on the bed. */
  machinePosition: (setup: FirmwareSetup, bed: Point3) => Point3
}
