import type { XYZ } from "../../../geometry/frame"
import { cornerInward, findsCorner, setsWorkXY, setsWorkZ } from "./params"
import type { OriginParams } from "./params"

/** What a 3D probing routine found, from the contacts it reported, in machine coordinates. */
export type OriginResult = {
  /** Machine X and Y where it set work X0 and Y0; null for an axis it has not set. */
  readonly origin: readonly [x: number | null, y: number | null]
  /** Machine Z of the top it set work Z0 on; null when it sets none, or has not yet. */
  readonly top: number | null
  /** A pocket's or boss's size between the sides it touched; null for corners and axes not probed. */
  readonly size: readonly [x: number | null, y: number | null]
  /** Whether it reported every contact the routine makes. */
  readonly complete: boolean
}

/**
 * What the routine found from its contacts with a ball of `ballDiameter`, in the order the
 * routine makes them: two touches on a top, and on each side a touch and a slower one, the second
 * of each counting. A corner
 * routine touches the top, then its X side and its Y side. A centre routine touches the top of a
 * boss first; then, per axis it centres (X before Y), the side towards minus and the side towards
 * plus.
 */
export function originResult(
  params: Pick<OriginParams, "routine" | "corner" | "axes">,
  ballDiameter: number,
  contacts: readonly XYZ<"machine">[]
): OriginResult {
  const radius = ballDiameter / 2
  // A touch counts from its second contact.
  const pair = (index: number): XYZ<"machine"> | null =>
    index + 1 < contacts.length ? contacts[index + 1] : null
  let next = 0
  let top: number | null = null
  if (setsWorkZ(params.routine)) {
    top = pair(next)?.[2] ?? null
    next += 2
  }
  const origin: [number | null, number | null] = [null, null]
  const size: [number | null, number | null] = [null, null]
  if (findsCorner(params.routine)) {
    // The side is the ball's radius beyond its centre: into the stock from outside, into the
    // wall from inside a pocket.
    const inward = cornerInward(params.corner)
    const toward = params.routine === "outside-corner" ? 1 : -1
    for (const axis of [0, 1] as const) {
      const touch = pair(next)
      next += 2
      if (touch) origin[axis] = touch[axis] + toward * inward[axis] * radius
    }
    return { origin, top, size, complete: contacts.length >= next }
  }
  // A pocket's walls are a ball's diameter wider apart than the centres that touched them, a
  // boss's sides as much narrower.
  const across = params.routine === "pocket-center" ? 1 : -1
  const centred = setsWorkXY(params.routine, params.axes)
  for (const axis of [0, 1] as const) {
    if (!centred[axis]) continue
    const minus = pair(next)
    const plus = pair(next + 2)
    next += 4
    if (minus && plus) {
      origin[axis] = (minus[axis] + plus[axis]) / 2
      size[axis] = plus[axis] - minus[axis] + across * 2 * radius
    }
  }
  return { origin, top, size, complete: contacts.length >= next }
}

/**
 * The machine X and Y a routine found, to keep as an anchor there: null unless it reported every
 * contact and set both work X0 and Y0.
 */
export function foundPosition({
  origin: [x, y],
  complete,
}: OriginResult): readonly [number, number] | null {
  return complete && x !== null && y !== null ? [x, y] : null
}
