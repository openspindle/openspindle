import { readNcBlock } from "@/machine/contract"
import type {
  JobMeasurement,
  MachineSnapshot,
  MachineState,
} from "@/machine/contract"
import type { Vec3 } from "@/domain/motion/spaces"
import type { MotionPlan, PlanIndex } from "@/domain/motion/types"
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

/**
 * How the Z1's player counts the bytes it has read (Player.cpp `played_cnt`), which its `P:`
 * percent is of the file's size: by each line, the bytes of the lines that run so far, as Run
 * prepares them (their code, without comments or line feed); and the size of the file sent,
 * line feeds included.
 */
type PlayedBytes = { readonly through: Float64Array; readonly size: number }

const playedBytes = new WeakMap<MotionPlan, PlayedBytes>()

function playedBytesOf(plan: MotionPlan): PlayedBytes {
  const cached = playedBytes.get(plan)
  if (cached) return cached
  const { lines } = plan.program
  const through = new Float64Array(lines.length)
  let played = 0
  let size = 0
  lines.forEach((line, index) => {
    const { code } = readNcBlock(line)
    played += code.length
    size += code.length + 1
    through[index] = played
  })
  const counted = { through, size }
  playedBytes.set(plan, counted)
  return counted
}

/**
 * The last line the machine can be running by the percent of its file it reports having read:
 * the first line its count (`PlayedBytes`) passes a percent up from it at, as the percent is
 * rounded, and `LINES_PAST_READ` more.
 */
function lineBoundOf(plan: MotionPlan, percent: number) {
  const { through, size } = playedBytesOf(plan)
  const read = (Math.min(100, percent + 1) / 100) * size
  let low = 0
  let high = through.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (through[middle] <= read) low = middle + 1
    else high = middle
  }
  return Math.min(through.length, low + 1) + LINES_PAST_READ
}

/**
 * The measurements each observation's snapshot held, to tell which the next replaced in place:
 * the machine refines a tool's fast touch with its slow one, and a probing routine's contacts
 * grow as it makes them, without the job's measurements growing.
 */
const measuredBy = new WeakMap<Observation, readonly JobMeasurement[]>()

const samePoint = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, axis) => value === b[axis])

/**
 * The contacts a measurement reports that `before`, the same measurement as an earlier snapshot
 * held it, did not, placed: all of a new one's; a touch again once refined; a routine's contacts
 * from the first it adds. None for a grid.
 */
function touchesOf(
  measurement: JobMeasurement,
  before: JobMeasurement | undefined,
  place: PlaceMachine
): TouchObservation[] {
  switch (measurement.kind) {
    case "touch":
      if (
        before?.kind === "touch" &&
        before.at === measurement.at &&
        samePoint(before.machine, measurement.machine)
      )
        return []
      return [
        {
          at: measurement.at,
          kind: measurement.target,
          tool: measurement.tool,
          point: place(measurement.machine),
          line: measurement.line,
        },
      ]
    case "contacts": {
      const known = before?.kind === "contacts" ? before.contacts.length : 0
      return measurement.contacts.slice(known).map((contact) => ({
        at: measurement.at,
        kind: "contact",
        tool: null,
        point: place(contact),
        line: measurement.line,
      }))
    }
    case "grid":
      return []
  }
}

/**
 * What a snapshot's status report tells about where a job's machine is in its plan, after the
 * job's `previous` observation: its tip by its machine position placed on the plate (`place`) and
 * by its work position, its line, tools, feed and wait, and the contacts measured since, those
 * the machine refined or added to in place included. A Pause's positions count from its second
 * report on. Null without a job or telemetry, or for the report `previous` came from.
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
  // Without the measurements the previous observation saw, as for a recorded one, only those
  // added since count.
  const held = before ? measuredBy.get(before) : []
  const seen = held ?? measurements.slice(0, before?.measured ?? 0)
  const touches = measurements.flatMap((measurement, at) =>
    held || at >= seen.length ? touchesOf(measurement, seen.at(at), place) : []
  )
  const observation: Observation = {
    at: telemetry.receivedAt,
    jobId: job.id,
    part: job.part,
    phase: job.phase,
    state,
    line: progress?.line ?? null,
    resumedLine: job.resumedLine,
    lineBound: progress ? lineBoundOf(index.plan, progress.percent) : null,
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
    touches,
  }
  measuredBy.set(observation, measurements)
  return observation
}
