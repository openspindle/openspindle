import { ruleById } from "@/domain/rules/rules"

/** The design rules formats 4 and 5 saved by name, and their rules' ids. */
const DESIGN_RULE_IDS: Readonly<Record<string, string>> = {
  maxCuttingFeed: "max-cutting-feed",
  maxPlungeRate: "max-plunge-rate",
  maxCutDepth: "max-cut-depth",
  maxDepthUnderStock: "max-depth-under-stock",
  spindleStoppedWhileCutting: "spindle-stopped-while-cutting",
  rapidIntoStock: "rapid-into-stock",
}

/** The ids formats 4 and 5 saved the machines' program rules by, at most this many of them. */
const PROGRAM_RULE_ID = /^[a-z0-9-]{1,64}$/
const MAX_PROGRAM_RULES = 100

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** A design rule as its rule's setting: a limit rule's `value` is its limit. */
function designRuleSetting(name: string, saved: unknown): unknown {
  const id = Object.hasOwn(DESIGN_RULE_IDS, name) ? DESIGN_RULE_IDS[name] : ""
  if (
    !ruleById(id)?.limit ||
    !isRecord(saved) ||
    !Object.hasOwn(saved, "value")
  )
    return saved
  const { value, ...setting } = saved
  return { ...setting, limit: value }
}

/**
 * The machines' program rules as settings. Ones their own schema refused stay under the name
 * they were saved by, which is no rule's id, so the rule settings' schema refuses them too.
 */
function programRuleSettings(programRules: unknown): [string, unknown][] {
  if (programRules === undefined) return []
  const ids = isRecord(programRules) ? Object.keys(programRules) : []
  if (
    !isRecord(programRules) ||
    ids.length > MAX_PROGRAM_RULES ||
    !ids.every((id) => PROGRAM_RULE_ID.test(id))
  )
    return [["programRules", programRules]]
  return Object.entries(programRules)
}

/** Whether a setting sets its rule as the rule is by default: its severity, and its limit. */
function isDefault(id: string, setting: unknown) {
  const rule = ruleById(id)
  return (
    rule !== undefined &&
    isRecord(setting) &&
    Object.keys(setting).every(
      (key) => key === "severity" || key === "limit"
    ) &&
    setting.severity === rule.severity &&
    setting.limit === rule.limit?.default
  )
}

/**
 * The rule settings of the design rules formats 4 and 5 saved (`designRules`): each design rule
 * by its rule's id, with the value it was saved with as its limit, and the machines' program
 * rules (`programRules`) as they were saved; without the settings that set a rule as it is by
 * default. Design rules their own schema refused stay as they were, for the rule settings' schema
 * to refuse; a project saved without design rules sets no rule.
 */
export function ruleSettingsFromDesignRules(designRules: unknown): unknown {
  if (designRules === undefined) return {}
  if (!isRecord(designRules)) return designRules
  const { programRules, ...rules } = designRules
  const settings: [string, unknown][] = [
    ...Object.entries(DESIGN_RULE_IDS)
      .filter(([name]) => Object.hasOwn(rules, name))
      .map(([name, id]): [string, unknown] => [
        id,
        designRuleSetting(name, rules[name]),
      ]),
    ...programRuleSettings(programRules),
  ]
  return Object.fromEntries(
    settings.filter(([id, setting]) => !isDefault(id, setting))
  )
}
