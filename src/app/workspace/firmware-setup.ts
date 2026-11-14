import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { FirmwareSetup } from "@/domain/firmware/firmware-model"
import type { Plate } from "@/domain/plate/plate"
import { fixtureSupportHeight } from "@/domain/fixtures/definitions"
import { fixtureSolids, standsUnder } from "@/domain/fixtures/solids"
import { anchorCalibrationIssue } from "@/domain/anchors/calibration"

/**
 * Where the plate is on its machine, as its firmware's moves are placed, with its program
 * starting where the machine waits once homed (`FirmwareModel.home`).
 */
export function firmwareSetup(plate: Plate, kit: FixtureKit): FirmwareSetup {
  const { anchors, deviceId, stock, stockAnchor, workOrigin, fixtures } =
    plate.setup
  const setup: FirmwareSetup = {
    anchors: anchors ?? kit.factoryAnchors(deviceId),
    workOrigin,
    stock: stock
      ? {
          min: stockAnchor,
          max: [
            stockAnchor[0] + stock.width,
            stockAnchor[1] + stock.depth,
            stockAnchor[2] + stock.height,
          ],
        }
      : null,
    supportZ: fixtureSupportHeight(fixtures, kit.tableTop),
    solids: fixtureSolids(fixtures),
  }
  const { firmware } = kit
  if (!firmware) return setup
  const source =
    plate.operations.length === 1 ? plate.operations[0].source : null
  if (
    source?.kind === "probing" &&
    source.task === "origin" &&
    source.diameterCalibration
  ) {
    const plan = source.diameterCalibration
    const bed = firmware.bedPosition(setup, plan.binding.position)
    // A schematic boss at the checked XY. Its physical Z is found by the bounded top touches.
    const top = setup.supportZ + plan.depth + 5
    const solid = {
      name: "Known-width reference (schematic height)",
      min: [bed[0] - plan.width / 2, bed[1] - 5, setup.supportZ] as [
        number,
        number,
        number,
      ],
      max: [bed[0] + plan.width / 2, bed[1] + 5, top] as [
        number,
        number,
        number,
      ],
    }
    return {
      ...setup,
      solids: [...setup.solids, solid],
      start: [
        bed[0] - workOrigin[0],
        bed[1] - workOrigin[1],
        top + plan.gap - workOrigin[2],
      ],
      fixedStart: true,
      initialTool: plan.binding.tool,
      probeRadius: plan.diameter / 2,
    }
  }
  if (
    source?.kind === "probing" &&
    source.task === "origin" &&
    source.anchorCalibration?.approach &&
    !anchorCalibrationIssue(source, plate.setup, kit)
  ) {
    const { binding, gap, diameter } = source.anchorCalibration.approach
    const bed = firmware.bedPosition(setup, binding.position)
    const top = Math.max(
      setup.supportZ,
      ...setup.solids
        .filter((solid) => standsUnder(solid, bed))
        .map((solid) => solid.max[2])
    )
    return {
      ...setup,
      // Machine Z depends on the measured stylus length. The bracket model + estimated gap
      // place its tip for this nominal preview; never invent a setter-derived absolute Z.
      start: [
        bed[0] - workOrigin[0],
        bed[1] - workOrigin[1],
        top + gap - workOrigin[2],
      ],
      fixedStart: true,
      initialTool: binding.tool,
      probeRadius: diameter / 2,
    }
  }
  const [x, y, z] = firmware.bedPosition(setup, firmware.home)
  return {
    ...setup,
    start: [x - workOrigin[0], y - workOrigin[1], z - workOrigin[2]],
  }
}
