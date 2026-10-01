import { kitForPlate } from "../fixtures/catalog"
import type { FixtureKit } from "../fixtures/fixture-kit"
import { machiningPrograms } from "../operations/kept-nc"
import type { Plate } from "../plate/plate"
import {
  stockWorkArea,
  toolpathBoundsOf,
  workAreaOnStock,
} from "./cutting-bounds"
import type { ToolpathBoundsResult, WorkAreaResult } from "./cutting-bounds"

export {
  cuts,
  cuttingBounds,
  roundOutward,
  workAreaOnStock,
} from "./cutting-bounds"
export type {
  BedXY,
  ToolpathBounds,
  ToolpathBoundsResult,
  WorkArea,
  WorkAreaResult,
} from "./cutting-bounds"

/**
 * Where a plate's machining cuts, as probing fits to it, measured from the NC of its operations
 * outside the setup phase (`machiningPrograms`) when first read: a probing strategy reads it only
 * where it needs it.
 */
export type PlateMachining = {
  /** The toolpath bounds, in work coordinates (`plateToolpathBounds`). */
  readonly toolpath: () => ToolpathBoundsResult
  /** The work area for probing (`plateWorkArea`). */
  readonly workArea: () => WorkAreaResult
}

/**
 * A plate's machining on its machine (`PlateMachining`): its NC resolved and measured once, when
 * first read.
 */
export function plateMachining(
  plate: Plate,
  kit: FixtureKit = kitForPlate(plate)
): PlateMachining {
  let programs: (string | null)[] | undefined
  let bounds: ToolpathBoundsResult | undefined
  const read = () => (programs ??= machiningPrograms(plate, kit))
  const toolpath = () => (bounds ??= toolpathBoundsOf(read()))
  return {
    toolpath,
    workArea: () => {
      const measured = toolpath()
      if (measured.ok) return workAreaOnStock(measured.bounds, plate.setup)
      if (read().length) return measured
      return stockWorkArea(plate.setup)
    },
  }
}

/**
 * Where a plate's machining cuts, in work coordinates: the cutting bounds of every operation
 * outside the setup phase (probing and scans are left out), each measured from its own NC, so a
 * setup operation can use them while its plate compiles. The one definition of a plate's
 * toolpath extent: the viewer outlines it and snaps to it, and the probing operations fit to it.
 */
export function plateToolpathBounds(plate: Plate): ToolpathBoundsResult {
  return plateMachining(plate).toolpath()
}

/**
 * The plate's work area for probing: its toolpath bounds on the stock, or the whole stock when
 * the plate has no machining operations to fit to.
 */
export function plateWorkArea(plate: Plate): WorkAreaResult {
  return plateMachining(plate).workArea()
}
