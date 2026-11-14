import type { ControllerInput } from "./gamepad-step-input"

export function directVector(
  input: ControllerInput
): readonly [number, number, number] {
  if (
    !input.supported ||
    !input.enableHeld ||
    input.stepModifierHeld ||
    input.spindleModifierHeld ||
    input.stopHeld ||
    input.dpadHeld
  )
    return [0, 0, 0]
  const radius = Math.hypot(input.x, input.y)
  const magnitude = Math.max(0, (Math.min(radius, 1) - 0.2) / 0.8)
  const z = Math.sign(input.z) * Math.max(0, (Math.abs(input.z) - 0.2) / 0.8)
  const x = radius ? (input.x / radius) * magnitude : 0
  const y = radius ? (-input.y / radius) * magnitude : 0
  const scale = Math.max(1, Math.hypot(x, y, z))
  return [x / scale, y / scale, z / scale]
}

export class DirectGesture {
  private ready = false
  take(input: ControllerInput): readonly [number, number, number] {
    if (input.stepModifierHeld || input.spindleModifierHeld || input.dpadHeld)
      this.ready = false
    else if (input.neutral) this.ready = true
    return this.ready ? directVector(input) : [0, 0, 0]
  }
}
