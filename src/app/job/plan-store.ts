import { firmwareSetup, machineProgram } from "@/app/workspace/machine-program"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { MachineLimits } from "@/domain/motion/limits"
import { planMotion } from "@/domain/motion/plan"
import { indexPlan } from "@/domain/motion/plan-index"
import type { MotionPlan, PlanIndex } from "@/domain/motion/types"
import type { GCodeProgram } from "@/domain/nc/gcode"
import type { Plate } from "@/domain/plate/plate"
import { fingerprint } from "@/lib/fingerprint"
import type { FirmwareConfiguration } from "@/machine/contract"

/** A plate's program as its machine moves through it (`machineProgram`). */
export function machineProgramOf(
  plate: Plate,
  program: GCodeProgram
): GCodeProgram {
  return machineProgram(plate, program)
}

/**
 * Each machine program's plans, by the key of the limits they are timed by. A machine program
 * stands for its program and the setup it was placed by, which it is parsed again for.
 */
const plans = new WeakMap<GCodeProgram, Map<string, MotionPlan>>()

/** How many holders, such as a Run's session, each plan has (`pinPlan`). */
const pins = new Map<MotionPlan, number>()

const indexes = new WeakMap<MotionPlan, PlanIndex>()

/**
 * The plan of the moves a plate's machine makes for its program, timed by `limits`; built once per
 * program, setup and limits. Null without limits, or when the preview does not follow the plate's
 * machine's firmware.
 */
export function planFor(
  plate: Plate,
  program: GCodeProgram,
  limits: MachineLimits | null
): MotionPlan | null {
  const kit = kitForPlate(plate)
  const { firmware } = kit
  if (!limits || !firmware) return null
  const machine = machineProgramOf(plate, program)
  const timed = plans.get(machine) ?? new Map<string, MotionPlan>()
  plans.set(machine, timed)
  const cached = timed.get(limits.key)
  if (cached) return cached
  const key = [
    kit.id,
    fingerprint(JSON.stringify(firmwareSetup(plate, kit))),
    limits.key,
    fingerprint(program.source),
  ].join("|")
  const plan = planMotion(key, machine, firmware.motion, limits)
  timed.set(limits.key, plan)
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
 * Keeps a plan from being dropped while something holds it, such as the session of the Run it
 * was sent with. The function returned lets go of it.
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
