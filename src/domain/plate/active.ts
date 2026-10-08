import type { Operation } from "../operations/operation"
import { pruneTools } from "../tools/tool-table"
import type { Plate } from "./plate"

/** Whether an operation is left out of what its plate machines. */
export const isSuppressed = (operation: Operation) =>
  operation.suppressed === true

/** Each operations array's operations that are not suppressed, so equal arrays stay equal. */
const activeOperations = new WeakMap<Plate["operations"], Operation[]>()

/** Each plate as it machines, so a plate keeps one projection while it does not change. */
const projected = new WeakMap<Plate, Plate>()

/**
 * A plate as it machines: without its suppressed operations, and its tool table without the
 * entries only they bind (numbers stay as they are). What compiles, runs and exports a plate,
 * and what checks it, reads this; editing reads the plate itself. The plate itself while
 * nothing is suppressed, and the same projection while it does not change, so what is cached
 * per plate or per operations array stays cached.
 */
export function activePlate(plate: Plate): Plate {
  if (!plate.operations.some(isSuppressed)) return plate
  let active = projected.get(plate)
  if (!active) {
    let operations = activeOperations.get(plate.operations)
    if (!operations) {
      operations = plate.operations.filter(
        (operation) => !isSuppressed(operation)
      )
      activeOperations.set(plate.operations, operations)
    }
    active = pruneTools({ ...plate, operations })
    projected.set(plate, active)
  }
  return active
}
