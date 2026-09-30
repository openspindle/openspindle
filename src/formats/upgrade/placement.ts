import { isJsonObject } from "./json"

/**
 * A probing placement as format 5 saved it, in format 6: its height was its offset's Z, and an
 * anchor's offset held X and Y by name. What else its offset held stays, for reading to leave
 * out and report: in a probe position's offset, or beside an anchor's.
 */
export function upgradePlacement(placement: unknown): unknown {
  if (!isJsonObject(placement) || !isJsonObject(placement.offset))
    return placement
  const { offset, ...rest } = placement
  const { x, y, z, ...unknown } = offset
  const height = z === undefined ? {} : { height: z }
  if (placement.kind === "anchor")
    return { ...unknown, ...rest, offset: [x, y], ...height }
  const leftOver = {
    ...unknown,
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
  }
  return {
    ...rest,
    ...height,
    ...(Object.keys(leftOver).length ? { offset: leftOver } : {}),
  }
}
