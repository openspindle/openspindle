import { kindOf } from "@/domain/operations/kinds"
import type { Operation } from "@/domain/operations/operation"
import { probingLabel } from "@/domain/probing/strategies"

/**
 * What kind of operation this is: a probing operation goes by its strategy, the others by their
 * kind's label.
 */
export function operationKindLabel(operation: Operation): string {
  const { source } = operation
  if (source.kind === "probing") return probingLabel({ source })
  return kindOf(operation).label
}

export function useOperationKindLabel(operation: Operation): string {
  return operationKindLabel(operation)
}
