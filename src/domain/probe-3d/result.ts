import { cornerInward, findsCorner, setsWorkZ } from "./params"
import type { Probe3dParams } from "./params"

/** A contact the probe reported, in machine coordinates. */
export type Probe3dContact = readonly [x: number, y: number, z: number]

/** What a 3D probing routine found, from the contacts it reported, in machine coordinates. */
export type Probe3dResult = {
  /** Machine X and Y where it set work X0 and Y0; null for an axis it has not set. */
  readonly origin: readonly [number | null, number | null]
  /** Machine Z of the top it set work Z0 on; null when it sets none, or has not yet. */
  readonly top: number | null
  /** A pocket's or boss's size between the sides it touched; null for corners and axes not probed. */
  readonly size: readonly [number | null, number | null]
  /** Whether it reported every contact the routine makes. */
  readonly complete: boolean
}

type Axis = 0 | 1

const CENTERED: Readonly<Record<Probe3dParams["axes"], readonly Axis[]>> = {
  xy: [0, 1],
  x: [0],
  y: [1],
}

/**
 * What the routine found from its contacts, in the order the routine makes them: two touches on
 * a top, and on each side a touch and a slower one, the second of each counting. A corner
 * routine touches the top, then its X side and its Y side. A centre routine touches the top of a
 * boss first; then, per axis it centres (X before Y), the side towards minus and the side towards
 * plus.
 */
export function probe3dResult(
  params: Pick<Probe3dParams, "routine" | "corner" | "axes" | "ballDiameter">,
  contacts: readonly Probe3dContact[]
): Probe3dResult {
  const radius = params.ballDiameter / 2
  // A touch counts from its second contact.
  const pair = (index: number): Probe3dContact | null =>
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
  for (const axis of CENTERED[params.axes]) {
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
