import type { JsonObject } from "./json"
import { upgradePlacement } from "./placement"

/** Two fields as one value per axis, X then Y, where both are there; otherwise as they are. */
function paired(
  params: JsonObject,
  x: string,
  y: string,
  field: string
): JsonObject {
  if (params[x] === undefined || params[y] === undefined) return params
  const { [x]: xValue, [y]: yValue, ...rest } = params
  return { ...rest, [field]: [xValue, yValue] }
}

/**
 * An auto-level's parameters as format 5 saved them, in format 6: the grid's width and depth are
 * its size, and its columns and rows its points.
 */
export function upgradeAutoLevel(params: JsonObject): JsonObject {
  const grid = paired(
    paired(params, "width", "depth", "size"),
    "columns",
    "rows",
    "points"
  )
  return { ...grid, placement: upgradePlacement(params.placement) }
}
