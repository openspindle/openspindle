import type { JsonObject } from "./json"
import { upgradePlacement } from "./placement"

/**
 * A 3D probing's parameters as format 5 saved them, in format 6: its distances in X and in Y are
 * one pair.
 */
export function upgradeProbe3d(params: JsonObject): JsonObject {
  const { distanceX, distanceY, ...rest } = params
  const placement = upgradePlacement(params.placement)
  if (distanceX === undefined || distanceY === undefined)
    return { ...params, placement }
  return { ...rest, distance: [distanceX, distanceY], placement }
}
