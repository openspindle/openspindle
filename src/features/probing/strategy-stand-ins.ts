/**
 * Stand-ins for two probing helpers the domain is getting alongside this UI: why a strategy
 * cannot run on a plate (`ProbingStrategy.blocked`, `strategyBlocked`), and a probing operation's
 * label. Once they land, their callers import them from the domain and this file goes.
 */

import type { ProbingSource } from "@/domain/operations/operation"
import type { Plate } from "@/domain/plate/plate"
import { strategyOf } from "@/domain/probing/strategies"
import type { MachineProbing, TaskStrategy } from "@/domain/probing/strategy"

/** A strategy that may say why it cannot run on a plate. */
type BlockingStrategy = {
  readonly blocked?: (plate: Plate, machine: MachineProbing) => string | null
}

/**
 * Why a strategy cannot run on a plate, such as a firmware's Z probe on a plate whose work origin
 * is not kept relative to an anchor; null when it can.
 */
export function strategyBlocked(
  strategy: TaskStrategy,
  plate: Plate,
  machine: MachineProbing
): string | null {
  const { blocked } = strategy as BlockingStrategy
  return blocked?.(plate, machine) ?? null
}

/** A probing operation's label: its strategy's on the machine; Probing where it has none so named. */
export function probingLabel(
  source: ProbingSource,
  machine: MachineProbing | null
): string {
  return (machine && strategyOf(source.strategy, machine)?.label) ?? "Probing"
}
