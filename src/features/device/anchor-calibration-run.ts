import {
  anchorCalibrationParams,
  anchorCalibrationSetup,
} from "@/domain/anchors/calibration"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import { createPlate } from "@/domain/plate/plate"
import type { Plate, PlateSetup } from "@/domain/plate/plate"
import { newProbingOperation, strategyById } from "@/domain/probing/strategies"
import { bindTools } from "@/domain/tools/tool-table"
import type { Tool } from "@/domain/tools/tool"
import type { AnchorConfiguration, ProbeCheckBinding } from "@/machine/contract"

/** A standalone plate value for the existing runner; never inserted into the workspace. */
export function anchorCalibrationRun(input: {
  setup: PlateSetup
  kit: FixtureKit
  fixtureId: string
  tool: Tool
  anchors: AnchorConfiguration
  binding: ProbeCheckBinding | null
  gap: number
  maxTravel: [number, number, number]
  stage: "setter" | "contacts"
}): Plate {
  const { kit, tool, anchors, binding, stage } = input
  const reference = kit.anchorCalibration
  const params = anchorCalibrationParams(kit)
  if (
    !reference?.measurementNc ||
    !reference.boundedNc ||
    !kit.probing ||
    !params
  )
    throw new Error("This machine has no supported anchor calibration.")
  const setup = anchorCalibrationSetup(input.setup, kit, input.fixtureId)
  if (!setup.ok) throw new Error(setup.error)
  const calibrationSetup = {
    ...setup.value,
    assists: { ...setup.value.assists, bedClean: "off" as const },
  }
  const plate = {
    ...createPlate(
      stage === "setter"
        ? { ...calibrationSetup, workOriginAnchor: null }
        : calibrationSetup
    ),
    name:
      stage === "setter"
        ? "Anchor 1 — tool-setter detection"
        : "Anchor 1 — bounded contacts",
  }
  const added = newProbingOperation(
    plate,
    tool,
    strategyById("inside-corner")!,
    kit.probing
  )
  const source = added.operation.source
  if (source.kind !== "probing" || source.task !== "origin")
    throw new Error("No supported anchor probing method.")
  if (stage === "contacts" && (!binding || tool.diameter === null))
    throw new Error("Verify the fitted probe's live signal before probing.")
  const operation = {
    ...added.operation,
    name: plate.name,
    source:
      stage === "setter"
        ? {
            kind: "file" as const,
            nc: reference.measurementNc(),
            park: false,
            phase: "setup" as const,
          }
        : {
            ...source,
            params: { ...params, depth: Math.max(2, tool.diameter! / 2 + 0.5) },
            anchorCalibration: {
              anchorId: reference.anchorId,
              deviceId: input.setup.deviceId!,
              expectedAnchors: structuredClone(anchors),
              approach: {
                binding: structuredClone(binding!),
                gap: input.gap,
                diameter: tool.diameter!,
                maxTravel: input.maxTravel,
              },
            },
          },
  }
  return bindTools(
    { ...plate, operations: [operation] },
    operation,
    [source.probe],
    {
      preferred: added.preferredTools,
      library: [tool],
    }
  ).plate
}
