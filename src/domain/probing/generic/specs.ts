import type { OutlineSpecs } from "../tasks/outline/params"
import type { TouchOffSpecs } from "../tasks/touch-off/params"
import type { MachineProbing } from "../strategy"

/** A machine's ranges and defaults for the generic strategies, by strategy id. */
export type GenericSpecs = {
  readonly "surface-touch": TouchOffSpecs
  readonly "outline-trace": OutlineSpecs
}

/** Whether a machine gives a generic strategy the ranges and defaults it runs with. */
export const hasSpecs = (machine: MachineProbing, id: keyof GenericSpecs) =>
  machine.specs[id] !== undefined

/**
 * A generic strategy's ranges and defaults on a machine it runs on (`hasSpecs`), as a machine
 * offers only the generic strategies it runs (`machineStrategies`).
 */
export const specsOf = <TId extends keyof GenericSpecs>(
  machine: MachineProbing,
  id: TId
): GenericSpecs[TId] => machine.specs[id]!
