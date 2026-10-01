import { kindOf } from "@/domain/operations/kinds"
import type { Operation } from "@/domain/operations/operation"

export function operationKindLabel(operation: Operation): string {
  return kindOf(operation).label
}

export function useOperationKindLabel(operation: Operation): string {
  return operationKindLabel(operation)
}
