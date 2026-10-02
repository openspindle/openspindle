import { machineProgramOf } from "@/app/job/plan-store"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { Plate } from "@/domain/plate/plate"
import type { GCodeProgram, Point3 } from "@/domain/nc/gcode"
import type { SimulatedBed } from "@/machine/contract"
import { firmwareSetup } from "./firmware-setup"

/**
 * A plate's program as its machine moves through it: with its firmware's own moves (tool
 * changes, probing, moves in machine coordinates), placed by the plate's setup
 * (`machineProgramOf`). Parsed once per program and setup while the setup is among the
 * program's last few; the program itself when the preview does not follow the machine's
 * firmware.
 */
export function machineProgram(
  plate: Plate,
  program: GCodeProgram
): GCodeProgram {
  return machineProgramOf(plate, program)
}

/**
 * Where a machine position is on a plate's bed, for the tool work Z was set with; null when
 * the preview does not follow the plate's machine's firmware.
 */
export function bedPositionOf(plate: Plate, machine: Point3): Point3 | null {
  const kit = kitForPlate(plate)
  return kit.firmware?.bedPosition(firmwareSetup(plate, kit), machine) ?? null
}

/**
 * Where a machine position is in a plate's machine program: on its bed, from the plate's work
 * origin (`bedPositionOf`).
 */
export function programPositionOf(
  plate: Plate,
  machine: Point3
): Point3 | null {
  const bed = bedPositionOf(plate, machine)
  if (!bed) return null
  const [x, y, z] = plate.setup.workOrigin
  return [bed[0] - x, bed[1] - y, bed[2] - z]
}

/**
 * What the plate positions on its machine's bed, in machine coordinates as the preview places
 * them: its stock's box and what carries it. The simulator probes against it.
 */
export function simulatedBedOf(plate: Plate): SimulatedBed | null {
  const kit = kitForPlate(plate)
  const { firmware } = kit
  if (!firmware) return null
  const setup = firmwareSetup(plate, kit)
  const on = (point: Point3) => firmware.machinePosition(setup, point)
  const support = on([0, 0, setup.supportZ])[2]
  if (!setup.stock) return { stock: null, support }
  const [minX, minY] = on(setup.stock.min)
  const [maxX, maxY, top] = on(setup.stock.max)
  return { stock: { min: [minX, minY], max: [maxX, maxY], top }, support }
}
