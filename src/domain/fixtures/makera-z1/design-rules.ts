import type { RuleParameter } from "@/machine/contract"
import type { StageRule, MoveSubject } from "@/domain/rules/stages"
import { SETTER_RADIUS, SETTER_TOP } from "./tool-setter"
import { MAKERA_Z1_ID } from "./makera-z1"

const parameter = (
  id: string,
  label: string,
  min: number,
  max: number,
  defaultValue: number
): RuleParameter => ({
  id,
  label,
  unit: "mm",
  min,
  max,
  default: defaultValue,
})

/** The configurable toolsetter cylinder is checked by the design-rule evaluator. */
export const toolSetterClearance: StageRule<"move"> = {
  id: "tool-setter-clearance",
  stage: "move",
  label: "Fixed tool setter clearance",
  description:
    "A tool must not enter the fixed tool setter cylinder at or below its top.",
  severity: "error",
  configurable: true,
  machines: [MAKERA_Z1_ID],
  parameters: [
    parameter("x", "X from Anchor 1", -1_000, 1_000, 181),
    parameter("y", "Y from Anchor 1", -1_000, 1_000, 181),
    parameter("z", "Bottom Z", -1_000, 1_000, 0),
    parameter("radius", "Radius", 0.01, 1_000, SETTER_RADIUS),
    parameter("height", "Height", 0.01, 1_000, SETTER_TOP),
  ],
  test: (_subject: MoveSubject) => true,
  locate: () => [],
  explain: () => ({
    problem: "enters the fixed tool setter cylinder",
    advice: "Keep the tool above or clear of the fixed tool setter cylinder.",
  }),
}

export const Z1_DESIGN_RULES: readonly StageRule<"move">[] = [
  toolSetterClearance,
]
