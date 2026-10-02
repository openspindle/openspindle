import { useEffect } from "react"
import { programPositionOf } from "@/app/workspace/machine-program"
import { greedyTracker } from "@/domain/tracking/greedy"
import { hmmTracker } from "@/domain/tracking/hmm"
import { observationOf } from "@/domain/tracking/observation"
import type { Observation, Tracker } from "@/domain/tracking/types"
import { jobSessionStore } from "@/features/job/job-session"
import type { JobSession } from "@/features/job/job-session"
import { isFresh, isJobActive } from "@/machine/contract"
import type { MachineSnapshot } from "@/machine/contract"
import { useMachineHost } from "@/platform/machine"
import { devFlags } from "./dev-flags"
import { indexOf } from "./plan-store"
import { jobTrackingStore } from "./tracking-store"

/** The tracker a job starts with: the HMM, unless the developer flag asks for the greedy one. */
const chosenTracker = (): Tracker =>
  devFlags.tracker === "hmm" && hmmTracker ? hmmTracker : greedyTracker

const trackerNamed = (name: Tracker["name"]): Tracker =>
  name === "hmm" && hmmTracker ? hmmTracker : greedyTracker

/**
 * Mounted once, after `useMachineSync`: follows this window's Run through the plan it was sent
 * with, whichever page is open. Each snapshot's fresh status report of the session's job, while it
 * runs, is observed by the job's tracker into `jobTrackingStore`, and recorded too while the
 * developer flag asks for it. Another Run, or none, clears the store; a job that ended keeps where
 * it was last placed until it is dismissed.
 */
export function useJobTrackingSync() {
  const machine = useMachineHost()
  useEffect(() => {
    // Another machine process counts its snapshots' revisions from the beginning.
    let revision = -1
    /** The observations of the job followed, while they are recorded; the store shows them. */
    let recorded: Observation[] | null = jobTrackingStore.state?.recorded
      ? [...jobTrackingStore.state.recorded]
      : null
    const observe = (snapshot: MachineSnapshot) => {
      if (snapshot.revision <= revision) return
      revision = snapshot.revision
      const session = jobSessionStore.state
      const { job, telemetry } = snapshot
      if (!session?.plan || !job || job.id !== session.runId) return
      if (!isJobActive(job) || !isFresh(telemetry, Date.now())) return
      const index = indexOf(session.plan)
      const current = jobTrackingStore.state
      const same = current?.jobId === job.id && current.index === index
      const tracker = same ? trackerNamed(current.tracker) : chosenTracker()
      const state = same ? current.state : tracker.start(job.id, index)
      if (!same) recorded = devFlags.record ? [] : null
      const observation = observationOf(
        snapshot,
        state.last,
        (point) => programPositionOf(session.plate, point),
        index
      )
      if (!observation) return
      recorded?.push(observation)
      jobTrackingStore.setState(() => ({
        jobId: job.id,
        index,
        tracker: tracker.name,
        state: tracker.observe(index, state, observation),
        recorded,
      }))
    }
    const unsubscribe = machine.subscribe(observe)
    const forget = (value: JobSession | null) => {
      if (
        !jobTrackingStore.state ||
        jobTrackingStore.state.jobId === value?.runId
      )
        return
      recorded = null
      jobTrackingStore.setState(() => null)
    }
    forget(jobSessionStore.state)
    const session = jobSessionStore.subscribe(forget)
    return () => {
      unsubscribe()
      session.unsubscribe()
    }
  }, [machine])
}
