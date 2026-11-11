import { isFresh, isHeightCompensationOff, machineId } from "@/machine/contract"
import type {
  MachineSnapshot,
  ProbeCheckBinding,
  ProbeMovePlan,
  FirmwareConfiguration,
  PointZProbePlan,
  ZProbeSettings,
} from "@/machine/contract"
import { limitsFor } from "@/app/job/plan-store"
import { kitForSetup } from "@/domain/fixtures/catalog"
import type { Plate } from "@/domain/plate/plate"
import { samePointSetup } from "./point-intent"
import type { PointIntent } from "./point-intent"

export function pointFrameIssue(
  intent: PointIntent,
  plate: Plate | undefined,
  machine: MachineSnapshot
): string | null {
  if (!plate || !samePointSetup(plate.setup, intent.setup))
    return "The model setup changed. Right-click the point again."
  if (
    !machine.connection.device ||
    machine.connection.status !== "connected" ||
    machineId(machine.connection.device) !== intent.setup.deviceId
  )
    return "Connect this plate's machine first."
  const stored = intent.setup.anchors
  const actual = machine.anchors.value
  if (
    !stored ||
    stored.source !== "firmware-config" ||
    stored.deviceId !== intent.setup.deviceId ||
    !actual ||
    actual.anchors.some((entry) => {
      const held = stored.anchors.find((anchor) => anchor.id === entry.id)
      return (
        !held ||
        Math.abs(held.machinePosition[0] - entry.x) > 0.001 ||
        Math.abs(held.machinePosition[1] - entry.y) > 0.001
      )
    })
  )
    return "Read the device anchors and verify the model registration before positioning."
  const kit = kitForSetup(intent.setup)
  const [x, y] = intent.position
  if (
    [x, y].some(
      (value, axis) =>
        value < kit.workAreaOrigin[axis] ||
        value > kit.workAreaOrigin[axis] + kit.workArea[axis]
    )
  )
    return "The picked point is outside modeled machine travel. Choose a reachable point."
  return null
}

export function measuredPointProbe(
  machine: MachineSnapshot,
  number: number | undefined
) {
  const status = machine.telemetry
  return (
    number !== undefined &&
    isFresh(status, Date.now()) &&
    status.state === "Idle" &&
    status.job === null &&
    status.tool === number &&
    status.toolOffset !== null &&
    status.spindleRpm === 0 &&
    status.spindleOn !== true &&
    isHeightCompensationOff(status)
  )
}

export function pointMachineXY(
  intent: PointIntent
): readonly [number, number] | null {
  const anchor = intent.setup.anchors?.anchors[0]
  if (!anchor) return null
  return [
    anchor.machinePosition[0] + intent.position[0],
    anchor.machinePosition[1] + intent.position[1],
  ]
}

export function pointMovePlan(
  intent: PointIntent,
  machine: MachineSnapshot,
  binding: ProbeCheckBinding,
  configuration: FirmwareConfiguration | null
): ProbeMovePlan | null {
  const kit = kitForSetup(intent.setup)
  const xy = pointMachineXY(intent)
  const motion = limitsFor(kit, configuration)
  if (!kit.probePositioning || !xy || !motion) return null
  const feed = [...motion.axisRate] as [number, number, number]
  if (intent.action === "xy")
    return {
      mode: "xy",
      target: [
        xy[0],
        xy[1],
        Math.max(kit.probePositioning.clearance, binding.position[2]),
      ],
      feed,
    }
  const status = machine.telemetry
  if (
    intent.action !== "z" ||
    !status?.workOrigin ||
    status.toolOffset === null ||
    Math.hypot(binding.position[0] - xy[0], binding.position[1] - xy[1]) > 0.5
  )
    return null
  feed[2] *= 0.2
  return {
    mode: "z",
    target: [
      binding.position[0],
      binding.position[1],
      Number(
        (
          status.workOrigin.z +
          status.toolOffset +
          intent.position[2] -
          intent.setup.workOrigin[2] +
          5
        ).toFixed(4)
      ),
    ],
    feed,
  }
}

/** The model supplies XY only; the bounded contacts determine the real surface. */
export function pointZProbePlan(
  intent: PointIntent,
  configuration: FirmwareConfiguration | null,
  settings: ZProbeSettings
): PointZProbePlan | null {
  const kit = kitForSetup(intent.setup)
  const xy = pointMachineXY(intent)
  const motion = limitsFor(kit, configuration)
  if (!kit.zProbing?.pointNc || !xy || !motion) return null
  return {
    target: [...xy],
    feed: [...motion.axisRate],
    settings,
  }
}
