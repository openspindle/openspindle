const SETTLE_MS = 30_000
const UPDATE_MS = 30_000
const MIN_CHANGE_MS = 30_000

export type FinishTime = {
  readonly estimate: number
  readonly shown: number
  readonly at: number
  readonly updatedAt: number
}

/** Smooth the finish instant separately from the countdown and hold small corrections. */
export function settleFinishTime(
  previous: FinishTime | null,
  target: number,
  now: number
): FinishTime {
  if (!previous || now < previous.at || now - previous.at > 60_000)
    return { estimate: target, shown: target, at: now, updatedAt: now }
  const weight = 1 - Math.exp(-(now - previous.at) / SETTLE_MS)
  const estimate = previous.estimate + (target - previous.estimate) * weight
  const changed = Math.abs(estimate - previous.shown) >= MIN_CHANGE_MS
  const ready = now - previous.updatedAt >= UPDATE_MS
  // An estimate in the past must not keep promising a finish that has already passed.
  const overdue = previous.shown < now
  if (overdue)
    return {
      estimate: target,
      shown: Math.max(now, target),
      at: now,
      updatedAt: now,
    }
  if (changed && ready)
    return { estimate, shown: estimate, at: now, updatedAt: now }
  return { ...previous, estimate, at: now }
}
