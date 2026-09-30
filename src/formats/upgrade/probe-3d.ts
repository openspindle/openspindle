import type { JsonObject } from "./json"
import { upgradePlacement } from "./placement"

/** A 3D probing's parameters as format 5 saved them, in format 6. */
export function upgradeProbe3d(params: JsonObject): JsonObject {
  return { ...params, placement: upgradePlacement(params.placement) }
}
