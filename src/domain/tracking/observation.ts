import type {
  JobMeasurement,
  MachineSnapshot,
  MachineState,
} from "@/machine/contract"
import type { Vec3 } from "@/domain/motion/spaces"
import type { PlanIndex } from "@/domain/motion/types"
import type { Observation, TouchObservation } from "./types"

/** Where a machine position is in the plan's coordinates; null when it cannot be placed. */
export type PlaceMachine = (machine: Vec3) => Vec3 | null

/**
 * The states whose positions are where the machine is: MPos and WPos are live while it moves,
 * and the last target once its queue has emptied (Kernel.cpp).
 */
const TRUSTED: ReadonlySet<MachineState> = new Set([
  "Run",
  "Home",
  "Tool",
  "Idle",
])

/**
 * Lines of slack past the line at the byte position the machine reports having read (`P:`
 * percent, rounded, taken a percent up), which it does not execute beyond.
 */
const LINES_PAST_READ = 2

/** The contacts a measurement reports, placed; none for a grid. */
function touchesOf(
  measurement: JobMeasurement,
  place: PlaceMachine
): TouchObservation[] {
  switch (measurement.kind) {
    case "touch":
      return [
        {
          at: measurement.at,
          kind: measurement.target,
          tool: measurement.tool,
          point: place(measurement.machine),
          line: measurement.line,
        },
      ]
    case "contacts":
      return measurement.contacts.map((contact) => ({
        at: measurement.at,
        kind: "contact",
        tool: null,
        point: place(contact),
        line: measurement.line,
      }))
    case "grid":
      return []
  }
}

/**
 * What a snapshot's status report tells about where a job's machine is in its plan, after the
 * job's `previous` observation: its tip by its machine position placed on the plate (`place`) and
 * by its work position, its line, tools, feed and wait, and the contacts measured since. A
 * Pause's positions count from its second report on. Null without a job or telemetry, or for the
 * report `previous` came from.
 */
export function observationOf(
  snapshot: Pick<MachineSnapshot, "telemetry" | "job">,
  previous: Observation | null,
  place: PlaceMachine,
  index: PlanIndex
): Observation | null {
  const { telemetry, job } = snapshot
  if (!telemetry || !job || telemetry.receivedAt === previous?.at) return null
  const before = previous?.jobId === job.id ? previous : null
  const { machine, work, toolOffset, state } = telemetry
  const { progress, measurements } = job
  const seen = Math.min(before?.measured ?? 0, measurements.length)
  return {
    at: telemetry.receivedAt,
    jobId: job.id,
    part: job.part,
    phase: job.phase,
    state,
    line: progress?.line ?? null,
    resumedLine: job.resumedLine,
    lineBound: progress
      ? index.lineAtBytes(Math.min(1, (progress.percent + 1) / 100)) +
        LINES_PAST_READ
      : null,
    positionTrusted:
      TRUSTED.has(state) || (state === "Pause" && before?.state === "Pause"),
    // A tool longer than the one work Z was set with has its tip lower by the difference.
    machineTip: machine
      ? place([machine.x, machine.y, machine.z - (toolOffset ?? 0)])
      : null,
    workTip: work ? [work.x, work.y, work.z] : null,
    toolOffset,
    tool: { active: telemetry.tool, target: telemetry.requestedTool },
    feed: { current: telemetry.feed, override: telemetry.feedOverride },
    wait: job.wait,
    measured: measurements.length,
    touches: measurements
      .slice(seen)
      .flatMap((measurement) => touchesOf(measurement, place)),
  }
}
