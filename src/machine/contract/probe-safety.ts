import { z } from "zod"

/** Shared limits for host-verified part contacts; these are travel limits, not deflection ratings. */
export const ProbeSearchTravelSchema = z.number().finite().min(0.4).max(10)
export const ProbeTopGapSchema = z.number().finite().min(0.1).max(5)

export const PROBE_SAFETY_GUIDELINES =
  "Fit and measure an undamaged probe, connect its cable and verify one touch and release. Position as instructed with the spindle stopped. Check the whole route for fixtures and choose each maximum search for the actual clearance. Travel limits do not limit force or probe compression. A missing contact or uncertain status stops the run; nothing is retried or enlarged automatically."

export const AUTOMATIC_PROBE_SAFETY_GUIDELINES =
  "Fit and measure an undamaged probe, connect its cable and verify one touch and release at its current stationary position. Review the automatic approach with the spindle stopped. Check the whole route for fixtures and choose the maximum search for the actual clearance. Travel limits do not limit force or probe compression. Contact during positioning, a missing measuring contact or uncertain status stops the run; nothing is retried or enlarged automatically."

export const UNBOUNDED_PROBE_REASON =
  "Physical probing requires a verified input and a bounded, checked contact sequence. Use the Anchor 1, probe diameter or Z probe guide. Native corner, center and height-map cycles are available for simulator practice only; their firmware searches cannot enforce the same limits."
