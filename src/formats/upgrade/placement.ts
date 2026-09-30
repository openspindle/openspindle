import { isJsonObject } from "./json"

/**
 * A probing placement as format 5 saved it, in format 6: its height was its offset's Z, and an
 * anchor's offset held X and Y by name. Anything else stays as it is, for reading to leave out.
 */
export function upgradePlacement(placement: unknown): unknown {
  if (!isJsonObject(placement) || !isJsonObject(placement.offset))
    return placement
  const { offset, ...rest } = placement
  const height = offset.z === undefined ? {} : { height: offset.z }
  if (placement.kind === "anchor")
    return { ...rest, offset: [offset.x, offset.y], ...height }
  return { ...rest, ...height }
}
