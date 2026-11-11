import { Store, useSelector } from "@tanstack/react-store"
import { pinPlan } from "@/app/job/plan-store"
import type { CompiledPlate } from "@/domain/compile/compile"
import type { MotionPlan } from "@/domain/motion/types"
import type { Plate } from "@/domain/plate/plate"
import type { Tool } from "@/domain/tools/tool"
import { isSimulator, machineId } from "@/machine/contract"
import type { ConnectedDevice } from "@/machine/contract"

/**
 * One Run, frozen when it is sent: the plate as it was (plates are immutable values, so the
 * reference is the snapshot), its compiled program and the library tools its tool table
 * referenced. The Job tab explains a job through its session, never through the live
 * workspace, so editing the plate during a job cannot change what the job view shows.
 */
export type JobSession = {
  /** The RunRequest id, which the machine reports back as the job id. */
  readonly runId: string
  readonly plate: Plate
  /** How the plate showed at Run: its name, or its number then. */
  readonly label: string
  readonly compiled: CompiledPlate
  /**
   * The moves its machine makes, timed by the machine's limits at Run; null when the preview does
   * not follow the machine's firmware.
   */
  readonly plan: MotionPlan | null
  readonly tools: readonly Tool[]
  /** Measurement provenance frozen at Run, independent of subsequent connections. */
  readonly device: {
    id: string
    name: string
    source: "simulator" | "physical"
  } | null
  /** Pauses (by `pauseKey`) whose one automatic height-map read has started. */
  readonly reviewedPauses: readonly string[]
}

export function createJobSession(
  plate: Plate,
  label: string,
  compiled: CompiledPlate,
  library: readonly Tool[],
  plan: MotionPlan | null,
  device: ConnectedDevice | null
): JobSession {
  const referenced = new Set(plate.tools.map((entry) => entry.toolId))
  return {
    runId: crypto.randomUUID(),
    plate,
    label,
    compiled,
    plan,
    tools: library.filter((tool) => referenced.has(tool.id)),
    device: device
      ? {
          id: machineId(device),
          name: device.name,
          source: isSimulator(device) ? "simulator" : "physical",
        }
      : null,
    reviewedPauses: [],
  }
}

type JobSessionActions = {
  /**
   * A new Run supersedes any earlier session. A session holds its plan (`pinPlan`) until it is
   * superseded or cleared.
   */
  begin: (session: JobSession) => void
  /** Dismiss: the Job tab returns to the selected plate. */
  clear: () => void
  /** Claims a pause's one automatic height-map read; false when already claimed. */
  claimReview: (runId: string, pauseKey: string) => boolean
}

/** The Run this window started. It outlives route changes and ends only on Dismiss. */
export const jobSessionStore = new Store<JobSession | null, JobSessionActions>(
  null,
  ({ get, setState }) => {
    /** Lets go of the plan the session holds. */
    let release = () => {}
    const hold = (session: JobSession | null) => {
      release()
      release = session?.plan ? pinPlan(session.plan) : () => {}
      setState(() => session)
    }
    return {
      begin: hold,
      clear: () => hold(null),
      claimReview: (runId, pauseKey) => {
        const session = get()
        if (
          session?.runId !== runId ||
          session.reviewedPauses.includes(pauseKey)
        )
          return false
        setState(() => ({
          ...session,
          reviewedPauses: [...session.reviewedPauses, pauseKey],
        }))
        return true
      },
    }
  }
)

export const useJobSession = () => useSelector(jobSessionStore)
