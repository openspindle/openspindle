import { isFresh, isHeightCompensationOff } from "../contract/index.ts"
import type {
  ProbeCheck,
  ProbeCheckBinding,
  Telemetry,
} from "../contract/index.ts"
import { MachineError } from "./errors.ts"

/** Completed electrical checks survive jogging; execution still requires a checked stationary pose. */
export class ProbeSignalCheck {
  value: ProbeCheck | null = null

  invalidate() {
    this.value = null
  }

  moved() {
    if (this.value?.phase !== "verified") this.invalidate()
  }

  observe(telemetry: Telemetry | null, connectionId: string, now: number) {
    const check = this.value
    if (!check) return
    if (
      check.connectionId !== connectionId ||
      now > check.expiresAt ||
      !isFresh(telemetry, now) ||
      !["Idle", "Run"].includes(telemetry.state) ||
      telemetry.job !== null ||
      telemetry.units !== "mm" ||
      !isHeightCompensationOff(telemetry) ||
      telemetry.spindleRpm !== 0 ||
      telemetry.spindleOn === true ||
      telemetry.tool !== check.binding.tool ||
      telemetry.toolOffset !== check.binding.toolOffset ||
      !telemetry.machine
    ) {
      this.invalidate()
      return
    }
    if (!this.validPose(telemetry, connectionId, now)) this.moved()
  }

  validPose(telemetry: Telemetry | null, connectionId: string, now: number) {
    const check = this.value
    if (!check) return false
    return (
      check.connectionId === connectionId &&
      now <= check.expiresAt &&
      this.matches(check.binding, telemetry, now)
    )
  }

  private matches(
    binding: Pick<ProbeCheckBinding, "position" | "tool" | "toolOffset">,
    telemetry: Telemetry | null,
    now: number
  ) {
    return !!(
      isFresh(telemetry, now) &&
      telemetry.state === "Idle" &&
      telemetry.job === null &&
      telemetry.units === "mm" &&
      isHeightCompensationOff(telemetry) &&
      telemetry.spindleRpm === 0 &&
      telemetry.spindleOn !== true &&
      telemetry.tool === binding.tool &&
      telemetry.toolOffset === binding.toolOffset &&
      telemetry.machine &&
      binding.position.every(
        (value, axis) =>
          Math.abs(
            value -
              [
                telemetry.machine!.x,
                telemetry.machine!.y,
                telemetry.machine!.z,
              ][axis]
          ) <= 0.001
      )
    )
  }

  stationaryRead(
    before: Telemetry,
    telemetry: Telemetry,
    now: number,
    tool: number
  ) {
    if (!before.machine || before.toolOffset === null) return false
    const readPose: Pick<
      ProbeCheckBinding,
      "position" | "tool" | "toolOffset"
    > = {
      position: [before.machine.x, before.machine.y, before.machine.z],
      tool,
      toolOffset: before.toolOffset,
    }
    return (
      this.matches(readPose, before, now) &&
      this.matches(readPose, telemetry, now)
    )
  }

  read(
    triggered: boolean | null,
    before: Telemetry,
    telemetry: Telemetry,
    connectionId: string,
    now: number,
    tool: number
  ) {
    this.observe(telemetry, connectionId, now)
    if (triggered === null) {
      this.invalidate()
      return
    }
    if (
      !telemetry.machine ||
      telemetry.toolOffset === null ||
      !this.stationaryRead(before, telemetry, now, tool)
    ) {
      this.moved()
      return
    }
    const retained = this.value?.phase === "verified" ? this.value : null
    if (!this.validPose(telemetry, connectionId, now)) this.value = null
    if (!this.value) {
      if (triggered) return
      const binding: ProbeCheckBinding = {
        id: crypto.randomUUID(),
        position: [
          telemetry.machine.x,
          telemetry.machine.y,
          telemetry.machine.z,
        ],
        tool,
        toolOffset: telemetry.toolOffset,
      }
      if (!this.matches(binding, telemetry, now)) return
      this.value = {
        phase: retained ? "verified" : "released",
        binding,
        connectionId,
        startedAt: retained?.startedAt ?? now,
        expiresAt: retained?.expiresAt ?? now + 120000,
      }
      return
    }
    if (this.value.phase === "released" && triggered)
      this.value = { ...this.value, phase: "triggered" }
    else if (this.value.phase === "triggered" && !triggered)
      this.value = { ...this.value, phase: "verified" }
    else if (this.value.phase === "verified" && triggered) this.invalidate()
  }

  consume(
    binding: ProbeCheckBinding,
    telemetry: Telemetry | null,
    connectionId: string,
    now: number
  ) {
    const value = this.value
    const valid =
      value?.phase === "verified" &&
      JSON.stringify(value.binding) === JSON.stringify(binding) &&
      this.validPose(telemetry, connectionId, now)
    this.invalidate()
    if (!valid)
      throw new MachineError(
        "refused",
        "Touch and release the measured probe once, then wait for a released-input check at the current stationary position before Run. The check expires after 120 seconds and can be used once."
      )
  }
}
