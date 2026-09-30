import { COMMAND_RULES } from "@/machine/contract"
import { HEIGHT_MAP_RULES } from "../auto-level/analysis"
import { AUTO_LEVEL_RULES, PROBING_RUN_RULES } from "../auto-level/rules"
import { AUTO_SCAN_RULES } from "../auto-scan/rules"
import { AUTO_Z_HEIGHT_RULES } from "../auto-z-height/rules"
import { STOCK_DEPTH_RULES } from "../compile/stock-depth"
import { PROGRAM_RULES } from "../design-rules/common-rules"
import { MOVE_RULES } from "../design-rules/move-rules"
import { Z1_RULES } from "../fixtures/makera-z1/program-rules"
import { PLUGIN_RULES } from "../operations/plugin-rules"
import { PLATE_RUN_RULES } from "../plate/run-rules"
import { WORK_ORIGIN_RULES } from "../plate/work-origin"
import { PROBE_3D_RULES } from "../probe-3d/rules"
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
  ...AUTO_LEVEL_RULES,
  ...AUTO_Z_HEIGHT_RULES,
  ...PROBE_3D_RULES,
  ...AUTO_SCAN_RULES,
  ...STOCK_DEPTH_RULES,
  ...PLUGIN_RULES,
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
