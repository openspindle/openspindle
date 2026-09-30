import { upgradeAutoLevel } from "./auto-level"
import { upgradeAutoZHeight } from "./auto-z-height"
import { upgradeProbe3d } from "./probe-3d"
import { isJsonObject } from "./json"
import type { JsonObject } from "./json"

/** How each probing kind's parameters change from format 5 to 6; other kinds keep theirs. */
const PARAMS: Readonly<Record<string, (params: JsonObject) => JsonObject>> = {
  "auto-level": upgradeAutoLevel,
  "auto-z-height": upgradeAutoZHeight,
  "probe-3d": upgradeProbe3d,
}

function upgradeOperation(operation: unknown): unknown {
  if (!isJsonObject(operation) || !isJsonObject(operation.source))
    return operation
  const { source } = operation
  const upgrade =
    typeof source.kind === "string" ? PARAMS[source.kind] : undefined
  if (!upgrade || !isJsonObject(source.params)) return operation
  return { ...operation, source: { ...source, params: upgrade(source.params) } }
}

/**
 * Operations as formats 4 and 5 saved them, in format 6: probing parameters hold a value per
 * axis together, and placements their height apart from their offset. What it does not
 * recognize stays as it is, for reading to leave out and report.
 */
export function upgradeOperations(operations: unknown): unknown {
  return Array.isArray(operations)
    ? operations.map(upgradeOperation)
    : operations
}
