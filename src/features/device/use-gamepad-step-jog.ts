import { useEffect, useEffectEvent, useRef, useState } from "react"
import type { MachineSnapshot } from "@/machine/contract"
import { useMachineHost, useMachineSnapshot } from "@/platform/machine"
import { useGamepadDirectJog } from "./use-gamepad-direct-jog"
import { log } from "@/app/errors/log"
import { readController, StepGesture } from "./gamepad-step-input"
import type { ControllerInput } from "./gamepad-step-input"

type Options = {
  connectionId: string | null
  enabled: boolean
  directSupported: boolean
  step: number
  speed: number
  spindleRpm: number
  adjustStep: (delta: -1 | 1) => void
  cycleSpeed: () => void
  stop: () => Promise<MachineSnapshot>
}

/** Every controller action uses a connection-bound machine-owned session. */
export function useGamepadStepJog(options: Options) {
  const [controllers, setControllers] = useState<ControllerInput[]>([])
  const [selection, setSelection] = useState("")
  const [armed, setArmed] = useState(false)
  const [notice, setNotice] = useState("Controller input monitor")
  const [mode, setMode] = useState<"step" | "direct">("step")
  const machine = useMachineHost()
  const snapshot = useMachineSnapshot()
  const armedRef = useRef(false)
  const armEpoch = useRef(0)
  const live = useRef<ControllerInput | null>(null)
  const gesture = useRef(new StepGesture())
  const actionHeld = useRef({
    up: false,
    down: false,
    start: false,
    stop: false,
  })
  const stepButtonHeld = useRef({ left: true, right: true })
  const speedButtonHeld = useRef(true)
  const disarm = (message = "Controller disarmed", halt = false) => {
    armEpoch.current++
    speedButtonHeld.current = true
    stepButtonHeld.current = { left: true, right: true }
    if (armedRef.current) log.info(`Gamepad: ${message}`)
    armedRef.current = false
    gesture.current.reset()
    setArmed(false)
    setNotice(message)
    direct.end(message, halt)
  }
  const direct = useGamepadDirectJog({
    machine,
    connectionId: options.connectionId,
    speed: options.speed,
    mode,
    onNotice: setNotice,
    onFailure: disarm,
  })
  const directSeen = useRef(false)
  const observeSession = useEffectEvent(() => {
    if (!direct.active) {
      directSeen.current = false
      return
    }
    if (snapshot.activity?.label === "Gamepad controller")
      directSeen.current = true
    else if (directSeen.current) disarm("Direct session ended — arm again")
  })
  useEffect(() => observeSession(), [direct.active, snapshot.activity])
  const handle = useEffectEvent((input: ControllerInput | null) => {
    live.current = input
    const delta = input?.stepDelta ?? null
    const adjusting = delta !== null && input?.stopHeld === false
    const stepPressed =
      (delta === -1 && !stepButtonHeld.current.left) ||
      (delta === 1 && !stepButtonHeld.current.right)
    if (
      adjusting &&
      stepPressed &&
      input.supported &&
      options.enabled &&
      document.hasFocus() &&
      !document.hidden
    ) {
      options.adjustStep(delta)
      log.info("Gamepad step-size change", { delta })
      setNotice("Step size changed")
    }
    // Track physical presses even when the chord is blocked or focus is lost.
    stepButtonHeld.current = {
      left: input?.dpadLeftHeld ?? false,
      right: input?.dpadRightHeld ?? false,
    }
    if (
      input?.speedCycleHeld &&
      !speedButtonHeld.current &&
      input.supported &&
      options.enabled &&
      document.hasFocus() &&
      !document.hidden &&
      !input.stopHeld &&
      !input.spindleModifierHeld &&
      !input.stepModifierHeld &&
      !input.dpadHeld
    ) {
      options.cycleSpeed()
      log.info("Gamepad jog-speed cycle requested")
      setNotice("Jog speed changed")
    }
    // Consume blocked/held presses too; releasing another button must not replay a click.
    speedButtonHeld.current =
      !document.hasFocus() || document.hidden || !input?.supported
        ? true
        : input.speedCycleHeld
    if (!armedRef.current) return
    if (
      !input?.supported ||
      !options.enabled ||
      !document.hasFocus() ||
      document.hidden
    ) {
      disarm("Controller disarmed — connection or focus lost")
      return
    }
    if (input.stopHeld) {
      disarm("Stop requested — controller disarmed", true)
      // Stop bypasses the normal command's busy gate.
      void options
        .stop()
        .then((result) =>
          log.info("Gamepad Stop confirmed", {
            state: result.telemetry?.state,
            position: result.telemetry?.machine,
          })
        )
        .catch((error: Error) => setNotice(error.message))
      return
    }
    const held = {
      up: input.dpadUpHeld,
      down: input.dpadDownHeld,
      start: input.startHeld,
      stop: input.spindleStopHeld,
    }
    const previous = actionHeld.current
    actionHeld.current = held
    const now = Date.now()
    let action: Parameters<typeof direct.action>[0] | null = null
    if (input.spindleModifierHeld && !input.stepModifierHeld) {
      if (held.stop && !previous.stop) action = { kind: "stop" }
      else if (!held.stop && held.start && !previous.start && !input.rpmDelta) {
        if (input.neutral && !input.enableHeld)
          action = { kind: "start", rpm: options.spindleRpm }
        else setNotice("Centre both sticks and release LB before spindle start")
      } else if (
        !held.stop &&
        !held.start &&
        input.rpmDelta &&
        ((input.rpmDelta === 1 && !previous.up) ||
          (input.rpmDelta === -1 && !previous.down))
      ) {
        const limits = snapshot.limits
        if (limits)
          action = {
            kind: "target",
            rpm: Math.max(
              limits.spindleRpmMin,
              Math.min(
                limits.spindleRpmMax,
                options.spindleRpm + input.rpmDelta * 1000
              )
            ),
          }
      }
    }
    const direction = mode === "step" ? gesture.current.take(input) : null
    if (direction)
      action = {
        kind: "step",
        axis: direction.axis,
        distance: options.step * direction.sign,
        speedScale: options.speed / 100,
      }
    if (action) {
      const entry =
        action.kind === "step"
          ? snapshot.simulatorController.step
          : snapshot.simulatorController.spindle
      if (entry.allowed) {
        setNotice(`${action.kind} requested…`)
        direct.action(action, now)
      } else
        setNotice(entry.reason ?? "Controller action unavailable — press again")
    }
    direct.sample(input, now)
  })
  useEffect(() => {
    disarm()
    live.current = null
    let previousKey: string | null = null
    let lastFrame = performance.now()
    let lastDisplay = 0
    let previousDisplay = ""
    let previousInput = ""
    let frame = 0
    const poll = (now: number) => {
      if (now - lastFrame > 150 && armedRef.current)
        disarm("Controller disarmed — input delayed")
      lastFrame = now
      const inputs = Array.from(navigator.getGamepads())
        .filter((pad): pad is Gamepad => pad !== null && pad.connected)
        .map(readController)
      const input =
        inputs.find((entry) => entry.key === selection) ??
        (selection ? null : (inputs[0] ?? null))
      const key = input?.key ?? null
      if (key !== previousKey) {
        // Invalidate a pending begin too, before its completion can arm this input.
        disarm("Controller changed — arm again")
        gesture.current.reset()
        previousKey = key
      }
      handle(input)
      if (now - lastDisplay >= 100) {
        lastDisplay = now
        const observed = input && {
          x: Math.round(input.x * 10) / 10,
          y: Math.round(input.y * 10) / 10,
          z: Math.round(input.z * 10) / 10,
          xModifier: input.spindleModifierHeld,
          lb: input.enableHeld,
          rb: input.stepModifierHeld,
          l3: input.speedCycleHeld,
          b: input.stopHeld,
          direction: input.direction,
          neutral: input.neutral,
          armed: armedRef.current,
        }
        const inputSignature = JSON.stringify(observed)
        if (inputSignature !== previousInput) {
          previousInput = inputSignature
          log.info("Gamepad input", observed)
        }
        const display = JSON.stringify(inputs)
        if (display !== previousDisplay) {
          previousDisplay = display
          setControllers(inputs)
        }
      }
      frame = requestAnimationFrame(poll)
    }
    const loseFocus = () => disarm("Controller disarmed — focus lost")
    const disconnect = () => disarm("Controller disconnected — arm again")
    frame = requestAnimationFrame(poll)
    window.addEventListener("blur", loseFocus)
    window.addEventListener("gamepaddisconnected", disconnect)
    document.addEventListener("visibilitychange", loseFocus)
    return () => {
      cancelAnimationFrame(frame)
      armedRef.current = false
      gesture.current.reset()
      closeInput()
      window.removeEventListener("blur", loseFocus)
      window.removeEventListener("gamepaddisconnected", disconnect)
      document.removeEventListener("visibilitychange", loseFocus)
    }
  }, [options.connectionId, selection, mode])
  const closeInput = useEffectEvent(() => disarm("Controller input ended"))
  useEffect(() => {
    if (!options.directSupported) setMode("step")
  }, [options.directSupported])
  const selected =
    controllers.find((entry) => entry.key === selection) ??
    (selection ? null : (controllers[0] ?? null))
  const arm = async () => {
    const input = live.current
    if (
      !options.enabled ||
      !options.connectionId ||
      !document.hasFocus() ||
      direct.pending
    )
      return
    if (
      !input?.neutral ||
      input.enableHeld ||
      input.stepModifierHeld ||
      input.speedCycleHeld ||
      input.stopHeld ||
      input.spindleModifierHeld ||
      input.startHeld ||
      input.spindleStopHeld
    ) {
      setNotice(
        "Centre both sticks and release the D-pad, L3, LB, RB, A, B, X and Y before arming"
      )
      return
    }
    if (!snapshot.simulatorController.arm.allowed) {
      setNotice("Machine is unavailable for arming")
      return
    }
    setNotice("Arming controller…")
    const epoch = ++armEpoch.current
    if (!(await direct.begin())) return
    if (epoch !== armEpoch.current) return
    const current = live.current
    if (
      !current?.supported ||
      current.key !== input.key ||
      !current.neutral ||
      current.enableHeld ||
      current.stepModifierHeld ||
      current.speedCycleHeld ||
      current.stopHeld ||
      current.spindleModifierHeld ||
      current.startHeld ||
      current.spindleStopHeld ||
      !document.hasFocus() ||
      document.hidden
    ) {
      disarm(
        "Controls changed while arming — centre and release, then arm again"
      )
      return
    }
    actionHeld.current = {
      up: false,
      down: false,
      start: false,
      stop: false,
    }
    gesture.current.reset()
    gesture.current.take(current)
    armedRef.current = true
    setArmed(true)
    log.info("Gamepad armed", {
      mode,
      step: options.step,
      speed: options.speed,
    })
    setNotice(
      mode === "direct"
        ? "Armed — hold LB to steer"
        : "Armed — hold LB and choose a direction for one step"
    )
  }
  const select = (key: string) => {
    disarm()
    live.current = null
    setSelection(key)
  }
  return {
    mode,
    setMode: (value: "step" | "direct") => {
      disarm("Mode changed — arm again")
      setMode(value)
    },
    pending: direct.pending,
    controllers,
    selected,
    selection: selected?.key ?? "",
    select,
    armed,
    arm,
    disarm,
    notice,
  }
}
