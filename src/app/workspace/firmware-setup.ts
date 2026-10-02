import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { FirmwareSetup } from "@/domain/firmware/firmware-model"
import type { Plate } from "@/domain/plate/plate"
import { fixtureSupportHeight } from "@/domain/fixtures/definitions"
import { fixtureSolids } from "@/domain/fixtures/solids"

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
  const [x, y, z] = firmware.bedPosition(setup, firmware.home)
  return {
    ...setup,
    start: [x - workOrigin[0], y - workOrigin[1], z - workOrigin[2]],
  }
}
