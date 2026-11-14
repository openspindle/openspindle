import type { Axis } from "@/machine/contract"

export type StepDirection = { axis: Axis; sign: -1 | 1 }
export type ControllerInput = {
  key: string
  name: string
  supported: boolean
  x: number
  y: number
  z: number
  spindleModifierHeld: boolean
  startHeld: boolean
  spindleStopHeld: boolean
  rpmDelta: -1 | 1 | null
  neutral: boolean
  enableHeld: boolean
  stepModifierHeld: boolean
  speedCycleHeld: boolean
  stepDelta: -1 | 1 | null
  stopHeld: boolean
  conflicting: boolean
  dpadHeld: boolean
  dpadUpHeld: boolean
  dpadDownHeld: boolean
  dpadLeftHeld: boolean
  dpadRightHeld: boolean
  direction: StepDirection | null
}

/** Standard Gamepad API layout: Xbox left stick, LB, B and D-pad. */
export function readController(pad: Gamepad): ControllerInput {
  const pressed = (index: number) => pad.buttons[index]?.pressed === true
  const axesValid =
    pad.axes.length >= 4 && pad.axes.slice(0, 4).every(Number.isFinite)
  const supported =
    pad.mapping === "standard" && axesValid && pad.buttons.length >= 16
  const x = axesValid ? Math.max(-1, Math.min(1, pad.axes[0])) : 0
  const y = axesValid ? Math.max(-1, Math.min(1, pad.axes[1])) : 0
  const z = axesValid ? -Math.max(-1, Math.min(1, pad.axes[3])) : 0
  const up = pressed(12)
  const down = pressed(13)
  const left = pressed(14)
  const right = pressed(15)
  const dpad = up || down || left || right
  let conflicting = Number(up) + Number(down) + Number(left) + Number(right) > 1
  let stepDelta: -1 | 1 | null = null
  if (
    pressed(5) &&
    !pressed(4) &&
    !pressed(2) &&
    !conflicting &&
    (left || right)
  )
    stepDelta = right ? 1 : -1
  let direction: StepDirection | null = null
  if (dpad) {
    // Ambiguous D-pad combinations are consumed without moving.
    if (!conflicting) {
      if (up || down) direction = { axis: "Y", sign: up ? 1 : -1 }
      else direction = { axis: "X", sign: right ? 1 : -1 }
    }
  } else if (Math.max(Math.abs(x), Math.abs(y)) >= 0.55) {
    if (Math.abs(x) >= Math.abs(y))
      direction = { axis: "X", sign: x > 0 ? 1 : -1 }
    else direction = { axis: "Y", sign: y < 0 ? 1 : -1 }
  }
  if (Math.abs(z) >= 0.55) {
    if (direction) {
      direction = null
      conflicting = true
    } else direction = { axis: "Z", sign: z > 0 ? 1 : -1 }
  }
  let rpmDelta: -1 | 1 | null = null
  if (pressed(2) && !pressed(5) && !conflicting && (up || down))
    rpmDelta = up ? 1 : -1
  return {
    z,
    spindleModifierHeld: pressed(2),
    startHeld: pressed(0),
    spindleStopHeld: pressed(3),
    rpmDelta,
    key: `${pad.index}:${pad.id}`,
    name: pad.id,
    supported,
    x,
    y,
    neutral:
      supported && !dpad && Math.hypot(x, y) <= 0.2 && Math.abs(z) <= 0.2,
    enableHeld: pressed(4),
    stepModifierHeld: pressed(5),
    speedCycleHeld: pressed(10),
    stepDelta,
    stopHeld: pressed(1),
    conflicting,
    dpadHeld: dpad,
    dpadUpHeld: up,
    dpadDownHeld: down,
    dpadLeftHeld: left,
    dpadRightHeld: right,
    direction: supported ? direction : null,
  }
}

/** One step per excursion from centre. A refused/busy gesture is never replayed. */
export class StepGesture {
  private ready = false
  reset() {
    this.ready = false
  }
  take(input: ControllerInput): StepDirection | null {
    if (
      !input.supported ||
      input.stopHeld ||
      input.conflicting ||
      input.stepModifierHeld ||
      input.spindleModifierHeld
    ) {
      this.reset()
      return null
    }
    if (input.neutral) {
      this.ready = true
      return null
    }
    if (!input.direction) return null
    const ready = this.ready
    this.ready = false
    return ready && input.enableHeld ? input.direction : null
  }
}
