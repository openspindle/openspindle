import type { JsonObject } from "./json"
import { upgradePlacement } from "./placement"

/** An auto-level's parameters as format 5 saved them, in format 6. */
export function upgradeAutoLevel(params: JsonObject): JsonObject {
  return { ...params, placement: upgradePlacement(params.placement) }
}
