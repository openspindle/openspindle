import { Store, useSelector } from "@tanstack/react-store"
import type { PlanIndex } from "@/domain/motion/types"
import type {
  Observation,
  Tracker,
  TrackerState,
} from "@/domain/tracking/types"

/** Where this window's Run is in its plan, as its tracker follows the machine's reports. */
export type JobTracking = {
  readonly jobId: string
  readonly index: PlanIndex
  readonly tracker: Tracker["name"]
  readonly state: TrackerState
  /** The observations so far, while they are recorded; null otherwise. */
  readonly recorded: readonly Observation[] | null
}

export const jobTrackingStore = new Store<JobTracking | null>(null)

export const useJobTracking = () => useSelector(jobTrackingStore)
