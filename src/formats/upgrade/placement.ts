import { isJsonObject } from "./json"

/** The keys a placement has or may have now, which no other key may take. */
const PLACEMENT_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "anchorId",
  "offset",
  "height",
])

/**
 * A probing placement as earlier formats saved it, in the current one: its height was its
 * offset's Z, and an anchor's offset held X and Y by name. A height it has already stays, and the
 * offset's Z is then left over. What else the offset held stays where reading reports it: in a
 * probe position's offset, or beside an anchor's keys unless one of them would take a key a
 * placement has, which leaves the placement as it is. Other placements stay as they are.
 */
export function upgradePlacement(placement: unknown): unknown {
  if (!isJsonObject(placement) || !isJsonObject(placement.offset))
    return placement
  const { offset, ...rest } = placement
  const { x, y, z, ...others } = offset
  const raised = z !== undefined && !Object.hasOwn(rest, "height")
  const height = raised ? { height: z } : {}
  const leftOver = { ...others, ...(z === undefined || raised ? {} : { z }) }
  if (placement.kind === "probe-position") {
    const kept = {
      ...leftOver,
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
    }
    return {
      ...rest,
      ...height,
      ...(Object.keys(kept).length ? { offset: kept } : {}),
    }
  }
  if (placement.kind !== "anchor" || x === undefined || y === undefined)
    return placement
  const collides = Object.keys(leftOver).some(
    (key) => PLACEMENT_KEYS.has(key) || Object.hasOwn(rest, key)
  )
  if (collides) return placement
  return { ...rest, offset: [x, y], ...height, ...leftOver }
}
