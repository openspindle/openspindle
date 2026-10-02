import type { OutlineSpecs } from "../tasks/outline/params"
import type { TouchOffSpecs } from "../tasks/touch-off/params"
import type { MachineProbing } from "../strategy"

/** A machine's ranges and defaults for the generic methods, by method id. */
export type GenericSpecs = {
  readonly touch: TouchOffSpecs
  readonly outline: OutlineSpecs
}

/** Whether a machine gives a generic method the ranges and defaults it runs with. */
export const hasSpecs = (machine: MachineProbing, id: keyof GenericSpecs) =>
  machine.specs[id] !== undefined

/**
 * A generic method's ranges and defaults on a machine it runs on (`hasSpecs`), as a machine
 * performs strategies only with the generic methods it runs (`strategyMethods`).
 */
export const specsOf = <TId extends keyof GenericSpecs>(
  machine: MachineProbing,
  id: TId
): GenericSpecs[TId] => machine.specs[id]!
