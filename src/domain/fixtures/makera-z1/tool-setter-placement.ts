import type { RuleSettings } from "@/machine/contract"
import { bedAnchors } from "@/domain/anchors/stored-anchors"
import type { Cylinder } from "@/domain/diagnostics"
import type { Plate } from "@/domain/plate/plate"
import { ruleParameters } from "@/domain/rules/settings"
import { kitForPlate } from "../catalog"
import { toolSetterClearance } from "./design-rules"

/** The fixed setter in bed coordinates, shared by its model and clearance check. */
export function toolSetterPlacement(
  plate: Plate,
  settings: RuleSettings
): Cylinder | null {
  if (!toolSetterClearance.machines?.includes(kitForPlate(plate).id))
    return null
  const parameters = ruleParameters(
    toolSetterClearance,
    settings[toolSetterClearance.id]
  )
  const anchor = bedAnchors(plate.setup.anchors ?? undefined)[0]?.position ?? [
    0, 0,
  ]
  return {
    kind: "cylinder",
    center: [anchor[0] + parameters.x, anchor[1] + parameters.y, parameters.z],
    radius: parameters.radius,
    height: parameters.height,
  }
}
