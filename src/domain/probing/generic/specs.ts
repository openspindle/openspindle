import type { AutoScanSpecs } from "../../auto-scan/params"
import type { AutoZHeightSpecs } from "../../auto-z-height/params"
import type { MachineProbing } from "../strategy"

/** A machine's ranges and defaults for the generic strategies, by strategy id. */
export type GenericSpecs = {
  readonly "surface-touch": AutoZHeightSpecs
  readonly "outline-trace": AutoScanSpecs
}

/** Whether a machine gives a generic strategy the ranges and defaults it runs with. */
export const hasSpecs = (machine: MachineProbing, id: keyof GenericSpecs) =>
  Object.hasOwn(machine.specs, id)

/**
 * A generic strategy's ranges and defaults on a machine. A machine keeps every strategy's by
 * strategy id, and a generic strategy's are its `GenericSpecs`.
 */
export const specsOf = <TId extends keyof GenericSpecs>(
  machine: MachineProbing,
  id: TId
) => machine.specs[id] as GenericSpecs[TId]
