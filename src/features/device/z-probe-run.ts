import { createOperation } from "@/domain/operations/operation"
import { createPlate } from "@/domain/plate/plate"
import type { PlateSetup } from "@/domain/plate/plate"
import type { FixtureKit } from "@/domain/fixtures/fixture-kit"
import type { Tool } from "@/domain/tools/tool"
import type {
  PointZProbePlan,
  ProbeCheckBinding,
  ZProbeSettings,
} from "@/machine/contract"

/** Standalone temporary plate, never added to the project or composed with cutting. */
export function zProbeRun(
  setup: PlateSetup,
  kit: FixtureKit,
  tool: Tool,
  number: number,
  settings: ZProbeSettings,
  binding: ProbeCheckBinding | null,
  stage: "setter" | "contacts",
  pointPlan?: PointZProbePlan
) {
  if (!kit.zProbing) throw new Error("This machine has no bounded Z routine.")
  if (stage === "contacts" && !binding)
    throw new Error("Verify the probe signal first.")
  let nc: string
  if (stage === "setter") nc = kit.zProbing.measurementNc(number)
  else if (pointPlan) {
    if (!kit.zProbing.pointNc)
      throw new Error("This machine has no automatic point Z routine.")
    nc = kit.zProbing.pointNc(binding!, pointPlan)
  } else nc = kit.zProbing.boundedNc(binding!, settings)
  const plate = createPlate({
    ...setup,
    probeBeforeRun: false,
    workOriginAnchor: null,
    assists: { vacuum: "off", blow: "off", bedClean: "off", antiStatic: "off" },
  })
  plate.name =
    stage === "setter"
      ? "Z probe — tool-setter detection"
      : "Z probe — part surface"
  plate.tools = [{ number, toolId: tool.id }]
  plate.operations = [
    createOperation(
      plate.name,
      {
        kind: "file",
        park: false,
        phase: "setup",
        nc,
      },
      { tools: [{ local: number, plate: number }] }
    ),
  ]
  return plate
}
