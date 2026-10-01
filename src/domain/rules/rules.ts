import { COMMAND_RULES } from "@/machine/contract"
import { STOCK_DEPTH_RULES } from "../compile/stock-depth"
import { PROGRAM_RULES } from "../design-rules/common-rules"
import { MOVE_RULES } from "../design-rules/move-rules"
import { Z1_RULES } from "../fixtures/makera-z1/program-rules"
import { PLATE_RUN_RULES } from "../plate/run-rules"
import { WORK_ORIGIN_RULES } from "../plate/work-origin"
import { PROBING_RUN_RULES } from "../probing/rules"
import { HEIGHT_MAP_RULES } from "../probing/tasks/grid/analysis"
import { GRID_RULES } from "../probing/tasks/grid/rules"
import { ORIGIN_RULES } from "../probing/tasks/origin/rules"
import { OUTLINE_RULES } from "../probing/tasks/outline/rules"
import { TOUCH_OFF_RULES } from "../probing/tasks/touch-off/rules"
import { TOOL_RULES } from "../tools/tool-table"
import type { AnyRule, StageName, StageRule } from "./stages"

/**
 * Every rule the app checks, in an order that counts: each chain's gates in turn, move rules
 * before program rules in design results, and the settings' rows (the move rules, then the
 * program rules of every machine, then each machine's own).
 */
export const RULES: readonly AnyRule[] = [
  ...COMMAND_RULES,
  ...PLATE_RUN_RULES,
  ...WORK_ORIGIN_RULES,
  ...PROBING_RUN_RULES,
  ...TOOL_RULES,
  ...GRID_RULES,
  ...TOUCH_OFF_RULES,
  ...ORIGIN_RULES,
  ...OUTLINE_RULES,
  ...STOCK_DEPTH_RULES,
  ...MOVE_RULES,
  ...PROGRAM_RULES,
  ...Z1_RULES,
  ...HEIGHT_MAP_RULES,
]

const STAGE_RULES = new Map<StageName, readonly AnyRule[]>(
  [...new Set(RULES.map((rule) => rule.stage))].map((stage) => [
    stage,
    RULES.filter((rule) => rule.stage === stage),
  ])
)

const RULES_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]))

/**
 * A stage's rules, in list order. Each rule's `stage` pairs it with that stage's subject;
 * TypeScript cannot correlate the union on its own, so this one cast is where that guarantee is
 * stated.
 */
export function rulesOf<TName extends StageName>(
  stage: TName
): readonly StageRule<TName>[] {
  return (STAGE_RULES.get(stage) ?? []) as readonly StageRule<TName>[]
}

/** The rule with an id; undefined for an id no rule has, such as a setting from a newer app. */
export function ruleById(id: string): AnyRule | undefined {
  return RULES_BY_ID.get(id)
}
