import { firmwareSetup } from "@/app/workspace/firmware-setup"
import { anchorsFromDevice } from "@/domain/anchors/stored-anchors"
import type { CompiledPlate } from "@/domain/compile/compile"
import { kitForDevice } from "@/domain/fixtures/catalog"
import { MAKERA_Z1_ID } from "@/domain/fixtures/makera-z1/makera-z1"
import { entersSetterClearance } from "@/domain/fixtures/makera-z1/setter-clearance"
import {
  SETTER_FROM_ANCHOR,
  SETTER_TOP,
} from "@/domain/fixtures/makera-z1/tool-setter"
import { parseGCode } from "@/domain/nc/gcode"
import type { Point3 } from "@/domain/nc/gcode"
import type { Plate } from "@/domain/plate/plate"
import type { Tool } from "@/domain/tools/tool"
import { toolRuleSubjects } from "@/domain/tools/tool-table"
import { machineId } from "@/machine/contract"
import type {
  AnchorConfiguration,
  CheckedStart,
  ConnectedDevice,
  Position,
  PreparedProgram,
  Telemetry,
} from "@/machine/contract"

export type ToolSetterCheck =
  | { readonly status: "pass"; readonly checkedStart?: CheckedStart }
  | { readonly status: "pending"; readonly reason: string }
  | { readonly status: "anchors"; readonly reason: string }
  | {
      readonly status: "collision"
      readonly reason: string
      readonly operation?: string
    }
  | { readonly status: "incomplete"; readonly reason: string }

/** An allowance for the nominal setter geometry and the preview's chord approximation. */
const SETTER_MARGIN = 1

export function checkToolSetter({
  plate,
  compiled,
  prepared,
  library,
  device,
  anchors,
  machine,
  work,
  units,
  keptTool,
}: {
  plate: Plate | null
  compiled: CompiledPlate | null
  prepared: PreparedProgram | null
  library: readonly Tool[]
  device: ConnectedDevice | null
  anchors: AnchorConfiguration | null
  machine: Position | null
  work: Position | null
  units: Telemetry["units"] | undefined
  keptTool: number | null
}): ToolSetterCheck {
  if (!device) return { status: "pass" }
  const kit = kitForDevice(device.model)
  if (!kit || kit.id !== MAKERA_Z1_ID || !kit.firmware)
    return { status: "pass" }
  if (!plate || !compiled || !prepared)
    return { status: "pending", reason: "Waits for the prepared program." }
  if (!machine || !work || !units)
    return {
      status: "pending",
      reason: "Waits for the machine's current position.",
    }
  if (!anchors)
    return {
      status: "anchors",
      reason: "Read the machine's anchors to locate the fixed tool setter.",
    }

  const setup = firmwareSetup(plate, kit)
  const liveAnchors = anchorsFromDevice(
    anchors,
    machineId(device),
    setup.anchors.bedOffset
  )
  const [anchorX, anchorY] = liveAnchors.anchors[0].machinePosition
  // XY follows the live machine offset. Bed Z still comes from the plate's setup.
  const workOrigin: Point3 = [
    machine.x - work.x - anchorX,
    machine.y - work.y - anchorY,
    setup.workOrigin[2],
  ]
  const setter: Point3 = [
    SETTER_FROM_ANCHOR[0] - workOrigin[0],
    SETTER_FROM_ANCHOR[1] - workOrigin[1],
    SETTER_TOP - workOrigin[2] + SETTER_MARGIN,
  ]
  const path = parseGCode(
    prepared.text,
    compiled.program.name,
    kit.firmware.preview({
      ...setup,
      anchors: liveAnchors,
      workOrigin,
      start: [work.x, work.y, work.z],
      units,
      ...(keptTool !== null && { tool: keptTool }),
    })
  )
  const radii = new Map(
    toolRuleSubjects(plate, library).map(({ entry, tool }) => [
      entry.number,
      Math.max(tool?.diameter ?? 0, tool?.geometry.shankDiameter ?? 0) / 2,
    ])
  )
  const widest = Math.max(0, ...radii.values())
  const hit = path.segments.find((segment) =>
    entersSetterClearance(
      segment,
      setter,
      (radii.get(segment.tool) ?? widest) + SETTER_MARGIN
    )
  )
  if (hit) {
    const operation = compiled.spans.find(
      ({ startLine, endLine }) => hit.line >= startLine && hit.line <= endLine
    )?.operationId
    return {
      status: "collision",
      reason: `Line ${hit.line} moves too low over the fixed tool setter. Raise Z before moving in X/Y and lower it only after clearing the setter.`,
      operation,
    }
  }
  return path.truncated || path.unreadable
    ? {
        status: "incomplete",
        reason:
          "The program could not be fully checked for tool setter clearance.",
      }
    : { status: "pass", checkedStart: { machine, work, units, keptTool } }
}
