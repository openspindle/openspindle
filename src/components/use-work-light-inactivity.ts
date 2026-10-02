import { useEffect, useEffectEvent, useRef, useState } from "react"
import { toast } from "sonner"
import { TELEMETRY_FRESH_MS, isFresh, isJobActive } from "@/machine/contract"
import {
  machineErrorCode,
  useMachineSnapshot,
  useWorkLightIdleOff,
} from "@/platform/machine"
import { useWorkLightPreferences } from "./work-light-preferences"

type IdleCycle = {
  target: string | null
  since: number | null
  checkedAt: number | null
  wallTime: number | null
  telemetryAt: number | null
  attempted: boolean
  generation: number
}

/** Turns the light off once per observed idle period while the app remains connected. */
export function useWorkLightInactivity() {
  const { idleMinutes } = useWorkLightPreferences()
  const snapshot = useMachineSnapshot()
  const { mutate, isPending } = useWorkLightIdleOff()
  const [error, setError] = useState<Error | null>(null)
  const request = useRef<AbortController | null>(null)
  const cycle = useRef<IdleCycle>({
    target: null,
    since: null,
    checkedAt: null,
    wallTime: null,
    telemetryAt: null,
    attempted: false,
    generation: 0,
  })

  const check = useEffectEvent((): number | null => {
    const now = performance.now()
    const wallTime = Date.now()
    const current = cycle.current
    const invalidateElapsed = () => {
      current.since = null
      request.current?.abort()
    }
    const { connection, telemetry } = snapshot
    const target = `${connection.id}:${connection.status}:${connection.restarting}:${idleMinutes}`
    const fresh = isFresh(telemetry, wallTime)
    const active =
      isJobActive(snapshot.job) ||
      (fresh &&
        (telemetry.state !== "Idle" ||
          telemetry.job !== null ||
          telemetry.spindleOn === true ||
          (telemetry.spindleRpm !== null && telemetry.spindleRpm > 0)))
    const lightOff = fresh && telemetry.lightOn === false

    if (current.target !== target || active || lightOff) {
      invalidateElapsed()
      if (current.target !== target || current.attempted) {
        current.generation++
        current.attempted = false
        setError(null)
      }
      current.target = target
    }

    // A sleeping/backgrounded app or a gap in status cannot establish continuous idle.
    // Keep a failed attempt latched: missing information never authorizes a retry.
    const elapsed = current.checkedAt === null ? 0 : now - current.checkedAt
    const wallElapsed =
      current.wallTime === null ? 0 : wallTime - current.wallTime
    const telemetryGap =
      telemetry !== null &&
      current.telemetryAt !== null &&
      telemetry.receivedAt - current.telemetryAt > TELEMETRY_FRESH_MS
    if (
      elapsed < 0 ||
      elapsed > TELEMETRY_FRESH_MS ||
      wallElapsed > TELEMETRY_FRESH_MS ||
      Math.abs(wallElapsed - elapsed) > 1000 ||
      telemetryGap
    )
      invalidateElapsed()
    current.checkedAt = now
    current.wallTime = wallTime
    current.telemetryAt = telemetry?.receivedAt ?? null

    if (
      idleMinutes === 0 ||
      connection.status !== "connected" ||
      connection.restarting ||
      connection.id === null
    ) {
      invalidateElapsed()
      return null
    }
    if (
      !fresh ||
      active ||
      telemetry.lightOn !== true ||
      telemetry.spindleOn !== false ||
      telemetry.spindleRpm !== 0
    ) {
      invalidateElapsed()
      return fresh ? null : 1000
    }
    if (current.attempted) return request.current ? 1000 : null
    current.since ??= now
    const remaining = idleMinutes * 60_000 - (now - current.since)
    if (remaining > 0) return Math.min(remaining, 1000)

    // App operations (including brightness changes) defer expiry, without restarting it.
    if (
      request.current ||
      isPending ||
      !snapshot.availability.lightOffWhenIdle.allowed
    )
      return 1000

    current.attempted = true
    const generation = current.generation
    const controller = new AbortController()
    request.current = controller
    mutate(
      { connectionId: connection.id, signal: controller.signal },
      {
        onError: (failure) => {
          if (controller.signal.aborted) return
          // Refused while another operation ran: the light goes off once that has ended.
          if (machineErrorCode(failure) === "busy") {
            if (cycle.current.generation === generation)
              cycle.current.attempted = false
            return
          }
          if (cycle.current.generation === generation) setError(failure)
          toast.error("Work light could not be turned off", {
            description: failure.message,
          })
        },
        onSettled: () => {
          if (request.current === controller) request.current = null
        },
      }
    )
    return 1000
  })

  // Snapshot changes only reschedule observation; leaving the provider cancels preflight.
  useEffect(() => () => request.current?.abort(), [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const delay = check()
      if (delay !== null) timer = setTimeout(schedule, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [snapshot, idleMinutes, isPending])

  return { pending: isPending, error }
}
