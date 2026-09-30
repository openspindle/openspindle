import type { MachineProbing, ProbingNc } from "../../probing/strategy"

const pending = (): never => {
  throw new Error("The Z1's probing NC is not written yet.")
}

/** The Z1's probing NC that generic strategies are made of. Placeholder until it is written. */
export const Z1_PROBING_NC: ProbingNc = {
  select: pending,
  pointer: { on: [] },
  indicator: { touching: [], touched: [] },
  travel: pending,
  touch: { fastFeed: 0, slowFeed: 0, backOff: 0 },
}

/** The Z1's ranges and defaults for the generic strategies. Placeholder until it is written. */
export const Z1_GENERIC_SPECS: MachineProbing["specs"] = {}
