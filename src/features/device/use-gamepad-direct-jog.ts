import { useEffect, useEffectEvent, useRef, useState } from "react"
import { DIRECT_INPUT_TTL_MS, DIRECT_SAMPLE_MS } from "@/machine/contract"
import type {
  SimulatedJogSession,
  SimulatedJogAction,
} from "@/machine/contract"
import type { MachineHost } from "@/platform/host"
import { machineErrorCode, useMachineSnapshot } from "@/platform/machine"
import { log } from "@/app/errors/log"
import type { ControllerInput } from "./gamepad-step-input"
import { DirectGesture } from "./gamepad-direct-input"

type Active = {
  token: SimulatedJogSession
  machine: MachineHost
  sequence: number
  actionSequence: number
  actionPending: boolean
  actionKind: SimulatedJogAction["action"]["kind"] | null
  inFlight: boolean
  sentAt: number
  pending: {
    vector: readonly [number, number, number]
    input: ControllerInput
    capturedAt: number
    speedScale: number
  } | null
  gesture: DirectGesture
  moving: boolean
  lastLog: number
  zeroAt: number | null
}
export function useGamepadDirectJog(options: {
  machine: MachineHost
  connectionId: string | null
  speed: number
  mode: "step" | "direct"
  onNotice: (message: string) => void
  onFailure: (reason: string) => void
}) {
  const record = useRef<Active | null>(null)
  const generation = useRef(0)
  const working = useRef(false)
  const [pending, setPending] = useState(false)
  const [active, setActive] = useState(false)
  const snapshot = useMachineSnapshot()
  useEffect(() => {
    const current = record.current
    const telemetry = snapshot.telemetry
    if (
      current &&
      current.zeroAt !== null &&
      telemetry &&
      telemetry.receivedAt >= current.zeroAt &&
      ["Idle", "Run"].includes(telemetry.state) &&
      telemetry.feed === 0
    ) {
      log.info("Controller zero confirmed", {
        delayMs: Date.now() - current.zeroAt,
        position: telemetry.machine,
      })
      current.zeroAt = null
    }
  }, [snapshot.telemetry])
  const notice = useEffectEvent((message: string) => options.onNotice(message))
  const fail = useEffectEvent((reason: string) => options.onFailure(reason))
  const end = (reason: string, halt = false) => {
    generation.current++
    const current = record.current
    record.current = null
    setActive(false)
    if (!current) return
    log.info("Controller end requested", {
      reason,
      sessionId: current.token.sessionId,
    })
    if (halt) return
    working.current = true
    setPending(true)
    void current.machine
      .endSimulatedJog(current.token)
      .then((result) => {
        log.info("Controller end confirmed", {
          state: result.telemetry?.state,
          position: result.telemetry?.machine,
        })
      })
      .catch((error: Error) => {
        log.warn("Controller end failed", error.message)
      })
      .finally(() => {
        working.current = false
        setPending(false)
      })
  }
  const begin = async () => {
    if (working.current || record.current || !options.connectionId) return false
    working.current = true
    setPending(true)
    const epoch = ++generation.current
    const machine = options.machine
    try {
      const token = await machine.beginSimulatedJog({
        connectionId: options.connectionId,
        mode: options.mode,
      })
      if (generation.current !== epoch) {
        await machine.endSimulatedJog(token)
        return false
      }
      record.current = {
        token,
        machine,
        sequence: 0,
        actionSequence: 0,
        actionPending: false,
        actionKind: null,
        inFlight: false,
        sentAt: 0,
        pending: null,
        gesture: new DirectGesture(),
        moving: false,
        lastLog: 0,
        zeroAt: null,
      }
      setActive(true)
      log.info("Controller armed", {
        sessionId: token.sessionId,
        mode: options.mode,
      })
      return true
    } catch (error) {
      if (generation.current === epoch)
        fail(error instanceof Error ? error.message : "Direct arming failed")
      return false
    } finally {
      working.current = false
      setPending(false)
    }
  }
  const flush = (current: Active) => {
    if (record.current !== current || current.inFlight || !current.pending)
      return
    const sample = current.pending
    current.pending = null
    const now = Date.now()
    if (
      now - sample.capturedAt >= DIRECT_INPUT_TTL_MS ||
      now < sample.capturedAt
    ) {
      end("Direct input delayed")
      fail("Direct input delayed — arm again")
      return
    }
    current.inFlight = true
    current.sentAt = now
    const moving = Math.hypot(...sample.vector) > 0
    if (current.moving && !moving) {
      current.zeroAt = now
      log.info("Controller zero requested", {
        sessionId: current.token.sessionId,
        capturedAt: sample.capturedAt,
      })
    }
    if (moving) current.zeroAt = null
    current.moving = moving
    const input = {
      ...current.token,
      sequence: ++current.sequence,
      capturedAt: sample.capturedAt,
      x: sample.vector[0],
      y: sample.vector[1],
      z: sample.vector[2],
      suppress:
        sample.input.stepModifierHeld || sample.input.spindleModifierHeld,
      spindleModifier:
        sample.input.spindleModifierHeld && !sample.input.stepModifierHeld,
      neutral: sample.input.neutral,
      enableHeld: sample.input.enableHeld,
      speedScale: sample.speedScale,
    }
    void current.machine
      .sampleSimulatedJog(input)
      .then((receipt) => {
        if (record.current === current && now - current.lastLog >= 1000) {
          current.lastLog = now
          log.info("Controller input accepted", {
            sequence: receipt.sequence,
            ageMs: Date.now() - sample.capturedAt,
            x: input.x,
            y: input.y,
            z: input.z,
          })
        }
      })
      .catch((error: Error) => {
        if (record.current === current && machineErrorCode(error) !== "busy") {
          end(error.message)
          fail(error.message)
        }
      })
      .finally(() => {
        current.inFlight = false
        // The next controller poll sends only its newest capture, never an older buffered move.
      })
  }
  const sample = (input: ControllerInput, capturedAt: number) => {
    const current = record.current
    if (!current) return
    const spindlePending =
      current.actionPending && current.actionKind !== "step"
    if (spindlePending) input = { ...input, spindleModifierHeld: true }
    const vector =
      options.mode === "direct"
        ? current.gesture.take(input)
        : ([0, 0, 0] as const)
    current.pending = {
      vector,
      input,
      capturedAt,
      speedScale: options.speed / 100,
    }
    const zero = Math.hypot(...vector) === 0
    if (
      (zero && current.moving) ||
      capturedAt - current.sentAt >= DIRECT_SAMPLE_MS
    )
      flush(current)
  }
  const action = (
    requested: SimulatedJogAction["action"],
    capturedAt: number
  ) => {
    const current = record.current
    if (!current) return
    if (current.inFlight || current.actionPending) {
      notice("Controller action busy — press again after it finishes")
      return
    }
    current.actionPending = true
    current.actionKind = requested.kind
    // Reserve only the short wire exchange locally; heartbeats continue during effect verification.
    current.inFlight = true
    const input = {
      ...current.token,
      sequence: ++current.actionSequence,
      capturedAt,
      action: requested,
    }
    log.info("Controller action requested", input)
    void current.machine
      .actionSimulatedJog(input)
      .then((receipt) => {
        if (record.current !== current) return
        log.info("Controller action confirmed", {
          receipt,
          action: requested,
        })
        notice(`${requested.kind} confirmed`)
      })
      .catch((error: Error) => {
        if (record.current !== current) return
        const code = machineErrorCode(error)
        log.warn("Controller action failed", {
          code,
          reason: error.message,
        })
        if (code && ["busy", "refused", "rejected", "cancelled"].includes(code))
          notice(error.message)
        else {
          end(error.message)
          fail(error.message)
        }
      })
      .finally(() => {
        current.actionPending = false
        current.actionKind = null
      })
    // The owner takes the wire lease synchronously; the next poll can try a fresh heartbeat.
    current.inFlight = false
  }
  const closeOnChange = useEffectEvent(() =>
    end("Connection or machine process changed")
  )
  useEffect(
    () => () => closeOnChange(),
    [options.connectionId, options.machine, options.mode]
  )
  return { pending, active, begin, sample, action, end }
}
