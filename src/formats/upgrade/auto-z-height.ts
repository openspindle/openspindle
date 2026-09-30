import type { JsonObject } from "./json"
import { upgradePlacement } from "./placement"

/** An auto Z-height's parameters as format 5 saved them, in format 6. */
export function upgradeAutoZHeight(params: JsonObject): JsonObject {
  return { ...params, placement: upgradePlacement(params.placement) }
}
