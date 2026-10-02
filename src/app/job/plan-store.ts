import { firmwareSetup } from "@/app/workspace/firmware-setup"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { FirmwareModel } from "@/domain/firmware/firmware-model"
import type { MachineLimits } from "@/domain/motion/limits"
import { planMotion } from "@/domain/motion/plan"
import { indexPlan } from "@/domain/motion/plan-index"
import type { MotionPlan, PlanIndex } from "@/domain/motion/types"
import { parseGCode } from "@/domain/nc/gcode"
import type { GCodeProgram, Point3 } from "@/domain/nc/gcode"
import type { Plate, PlateSetup } from "@/domain/plate/plate"
import { fingerprint } from "@/lib/fingerprint"
import type { FirmwareConfiguration } from "@/machine/contract"

/**
 * How many setups each program keeps its machine program for: the least recently used goes
 * first, unless it holds a pinned plan. Enough for the setup a Run was sent with and the plate
 * as it is edited since.
 */
const SETUPS_PER_PROGRAM = 4

/** A program placed by one setup: its machine program, and that program's plans by limits key. */
type Placed = {
  readonly program: GCodeProgram
  /** The setup's fingerprint, part of its plans' keys. */
  readonly setup: string
  readonly plans: Map<string, MotionPlan>
}

/** Each program's placements by the plate's kit and setup (`setupOf`), the most recently used last. */
const placements = new WeakMap<GCodeProgram, Map<string, Placed>>()

/** Each setup's firmware setup as JSON, made once per setup object. */
const setupJson = new WeakMap<PlateSetup, string>()

/** Each program's source fingerprint, part of its plans' keys. */
const sources = new WeakMap<GCodeProgram, string>()

/** How many holders, such as a Run's session, each plan has (`pinPlan`). */
const pins = new Map<MotionPlan, number>()

const indexes = new WeakMap<MotionPlan, PlanIndex>()

/** A start as the setup's key holds it: to a micrometre, which no report is finer than. */
const startKey = (start: Point3) =>
  start.map((value) => Number(value.toFixed(3)))

/**
 * Where a plate is on its machine (`firmwareSetup`), as JSON, with where its program starts when
 * that is not its work origin.
 */
function setupOf(plate: Plate, kit: FixtureKit, start: Point3 | null) {
  let json = setupJson.get(plate.setup)
  if (json === undefined) {
    json = JSON.stringify(firmwareSetup(plate, kit))
    setupJson.set(plate.setup, json)
  }
  return start ? `${json}\n${JSON.stringify(startKey(start))}` : json
}

/** Whether any of a placement's plans is held (`pinPlan`). */
const pinned = ({ plans }: Placed) =>
  [...plans.values()].some((plan) => pins.has(plan))

/**
 * A plate's program placed by its setup, starting at `start` (its work origin when null): parsed
 * with the plate's firmware once, and kept while the setup is among the program's last few
 * (`SETUPS_PER_PROGRAM`) or holds a pinned plan.
 */
function placedOf(
  plate: Plate,
  program: GCodeProgram,
  kit: FixtureKit,
  firmware: FirmwareModel,
  start: Point3 | null = null
): Placed {
  const setup = setupOf(plate, kit, start)
  const key = `${kit.id}\n${setup}`
  const placed = placements.get(program) ?? new Map<string, Placed>()
  placements.set(program, placed)
  const cached = placed.get(key)
  if (cached) {
    placed.delete(key)
    placed.set(key, cached)
    return cached
  }
  const made: Placed = {
    program: parseGCode(
      program.source,
      program.name,
      firmware.preview(
        start
          ? { ...firmwareSetup(plate, kit), start }
          : firmwareSetup(plate, kit)
      )
    ),
    setup: fingerprint(setup),
    plans: new Map(),
  }
  placed.set(key, made)
  for (const [other, entry] of placed) {
    if (placed.size <= SETUPS_PER_PROGRAM) break
    if (other !== key && !pinned(entry)) placed.delete(other)
  }
  return made
}

/**
 * A plate's program as its machine moves through it: with its firmware's own moves (tool
 * changes, probing, moves in machine coordinates), placed by the plate's setup. Parsed once per
 * program and setup (`placedOf`); the program itself when the preview does not follow the
 * machine's firmware.
 */
export function machineProgramOf(
  plate: Plate,
  program: GCodeProgram
): GCodeProgram {
  const kit = kitForPlate(plate)
  const { firmware } = kit
  if (!firmware) return program
  return placedOf(plate, program, kit, firmware).program
}

/**
 * The plan of the moves a plate's machine makes for its program, timed by `limits`; built once per
 * program, setup, start and limits. From the work origin it is on the machine program the viewer
 * draws (`machineProgramOf`); from `start`, where the machine was at Run, on a program of its own
 * (`MotionPlan.program`), which the job's views draw. Null without limits, or when the preview
 * does not follow the plate's machine's firmware.
 */
export function planFor(
  plate: Plate,
  program: GCodeProgram,
  limits: MachineLimits | null,
  start: Point3 | null = null
): MotionPlan | null {
  const kit = kitForPlate(plate)
  const { firmware } = kit
  if (!limits || !firmware) return null
  const placed = placedOf(plate, program, kit, firmware, start)
  const cached = placed.plans.get(limits.key)
  if (cached) return cached
  let source = sources.get(program)
  if (source === undefined) {
    source = fingerprint(program.source)
    sources.set(program, source)
  }
  const key = [kit.id, placed.setup, limits.key, source].join("|")
  const plan = planMotion(key, placed.program, firmware.motion, limits)
  placed.plans.set(limits.key, plan)
  return plan
}

/** Queries on a plan, made once per plan. */
export function indexOf(plan: MotionPlan): PlanIndex {
  const cached = indexes.get(plan)
  if (cached) return cached
  const index = indexPlan(plan)
  indexes.set(plan, index)
  return index
}

/**
 * The limits a kit's machine moves by: those its configuration sets when it was read, else its
 * defaults. Null when the preview does not follow the kit's firmware.
 */
export function limitsFor(
  kit: FixtureKit,
  configuration: FirmwareConfiguration | null
): MachineLimits | null {
  if (!kit.firmware) return null
  return kit.firmware.motion.limits(
    configuration?.content ?? null,
    configuration?.revision ?? null
  )
}

/**
 * Keeps a plan, and the machine program it is of, from being dropped while something holds it,
 * such as the session of the Run it was sent with. The function returned lets go of it.
 */
export function pinPlan(plan: MotionPlan): () => void {
  pins.set(plan, (pins.get(plan) ?? 0) + 1)
  let held = true
  return () => {
    if (!held) return
    held = false
    const holders = (pins.get(plan) ?? 1) - 1
    if (holders > 0) pins.set(plan, holders)
    else pins.delete(plan)
  }
}
