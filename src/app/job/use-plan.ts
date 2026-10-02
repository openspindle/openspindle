import { useMemo } from "react"
import { kitForPlate } from "@/domain/fixtures/catalog"
import type { CompiledPlate } from "@/domain/compile/compile"
import type { MachineLimits } from "@/domain/motion/limits"
import type { MotionPlan, PlanIndex } from "@/domain/motion/types"
import type { Plate } from "@/domain/plate/plate"
import { machineId } from "@/machine/contract"
import { useCachedConfiguration, useMachineSnapshot } from "@/platform/machine"
import { indexOf, limitsFor, planFor } from "./plan-store"

/** A plate and its compiled program, with the plan its Run was sent with, if any. */
export type PlanSubject = {
  readonly plate: Plate
  readonly compiled: CompiledPlate
  readonly plan?: MotionPlan | null
}

/**
 * The limits a plate's machine moves by: its device's configuration while that device is
 * connected and its configuration read, else its machine's defaults. The same limits while
 * neither the plate's machine nor its configuration changes.
 */
export function useMotionLimits(plate: Plate | null): MachineLimits | null {
  const { connection } = useMachineSnapshot()
  const configuration = useCachedConfiguration(connection.id)
  const { device } = connection
  const kit = plate && kitForPlate(plate)
  const own = !!plate && !!device && plate.setup.deviceId === machineId(device)
  return useMemo(
    () => kit && limitsFor(kit, own ? configuration : null),
    [kit, own, configuration]
  )
}

/** Queries on a subject's plan: the one its Run was sent with, else the plate's own. */
export function usePlanIndex(subject: PlanSubject | null): PlanIndex | null {
  const plate = subject?.plate ?? null
  const program = subject?.compiled.program ?? null
  const sent = subject?.plan
  const limits = useMotionLimits(sent ? null : plate)
  return useMemo(() => {
    const plan = sent ?? (plate && program && planFor(plate, program, limits))
    return plan ? indexOf(plan) : null
  }, [plate, program, sent, limits])
}
