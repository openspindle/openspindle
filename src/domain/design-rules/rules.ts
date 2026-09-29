import { z } from "zod"

/** How a broken rule is reported: as an error, as a warning, or not at all. */
export const RuleSeveritySchema = z.enum(["error", "warning", "ignore"])
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>

/** Rules with a limit, in the unit the rule names. */
export const LIMIT_RULES = [
  "maxCuttingFeed",
  "maxPlungeRate",
  "maxCutDepth",
  "maxDepthUnderStock",
] as const
export type LimitRuleId = (typeof LIMIT_RULES)[number]

/** Rules a move keeps or breaks, without a limit. */
export const CHECK_RULES = [
  "spindleStoppedWhileCutting",
  "rapidIntoStock",
] as const
export type CheckRuleId = (typeof CHECK_RULES)[number]

export type DesignRuleId = LimitRuleId | CheckRuleId

export const isLimitRule = (rule: DesignRuleId): rule is LimitRuleId =>
  (LIMIT_RULES as readonly DesignRuleId[]).includes(rule)

type RuleInfo = {
  readonly label: string
  readonly description: string
}

type LimitInfo = RuleInfo & {
  readonly unit: "mm" | "mm/min"
  readonly min: number
  readonly max: number
}

/** What each rule with a limit checks, as the settings and results name and describe it. */
export const LIMIT_RULE_INFO: Readonly<Record<LimitRuleId, LimitInfo>> = {
  maxCuttingFeed: {
    label: "Max cutting feed",
    description: "The fastest feed a move may cut at.",
    unit: "mm/min",
    min: 1,
    max: 100_000,
  },
  maxPlungeRate: {
    label: "Max plunge rate",
    description:
      "The fastest a cutting move may go down: a straight plunge at its feed, a ramp at part of it.",
    unit: "mm/min",
    min: 1,
    max: 100_000,
  },
  maxCutDepth: {
    label: "Max cut depth",
    description: "How far below the stock top a cut may reach, in total.",
    unit: "mm",
    min: 0,
    max: 1_000,
  },
  maxDepthUnderStock: {
    label: "Max depth under the stock",
    description:
      "How far a cut may reach below the stock bottom, into what the stock lies on.",
    unit: "mm",
    min: 0,
    max: 1_000,
  },
}

/** What each rule without a limit checks. */
export const CHECK_RULE_INFO: Readonly<Record<CheckRuleId, RuleInfo>> = {
  spindleStoppedWhileCutting: {
    label: "Spindle stopped while cutting",
    description:
      "A move cuts while the spindle is stopped, or turns without a speed.",
  },
  rapidIntoStock: {
    label: "Rapid move into the stock",
    description: "A rapid move (G0) goes into the stock.",
  },
}

export const ruleInfo = (rule: DesignRuleId): RuleInfo =>
  isLimitRule(rule) ? LIMIT_RULE_INFO[rule] : CHECK_RULE_INFO[rule]

/** A rule's limit, within the range its unit allows. */
export function limitValueSchema(rule: LimitRuleId) {
  const { label, unit, min, max } = LIMIT_RULE_INFO[rule]
  const range = `${label} must be from ${min} to ${max.toLocaleString("en-US")} ${unit}.`
  return z
    .number({ error: `${label} is required.` })
    .min(min, range)
    .max(max, range)
}

const limitSchema = (rule: LimitRuleId) =>
  z.object({ value: limitValueSchema(rule), severity: RuleSeveritySchema })

const CheckSchema = z.object({ severity: RuleSeveritySchema })

/** At most this many of the machines' program rules set by a project. */
const MAX_PROGRAM_RULES = 100

/**
 * How a project reports the programs that break its machines' rules (`ProgramRule`), by the
 * rule's id; a rule it does not set is reported as the machine's kit says.
 */
const ProgramRuleSeveritiesSchema = z
  .partialRecord(z.string().regex(/^[a-z0-9-]{1,64}$/), CheckSchema)
  .refine(
    (rules) => Object.keys(rules).length <= MAX_PROGRAM_RULES,
    `A project sets at most ${MAX_PROGRAM_RULES} program rules.`
  )

/** The rules a new project starts with, and that a project which does not set a rule takes. */
export const DEFAULT_DESIGN_RULES = {
  maxCuttingFeed: { value: 2000, severity: "warning" },
  maxPlungeRate: { value: 300, severity: "warning" },
  maxCutDepth: { value: 3, severity: "warning" },
  maxDepthUnderStock: { value: 0.3, severity: "warning" },
  spindleStoppedWhileCutting: { severity: "warning" },
  rapidIntoStock: { severity: "warning" },
} as const

/**
 * The limits a project's plates are checked against (Check design rules, and the Job tab's
 * checks before Run), each reported as an error or a warning, or ignored, and how the programs
 * that break their machines' rules are reported. Errors block Run; nothing blocks export. A rule
 * a project does not set takes its default, so projects saved before it existed open with it.
 */
export const DesignRulesSchema = z.object({
  maxCuttingFeed: limitSchema("maxCuttingFeed").default(() => ({
    ...DEFAULT_DESIGN_RULES.maxCuttingFeed,
  })),
  maxPlungeRate: limitSchema("maxPlungeRate").default(() => ({
    ...DEFAULT_DESIGN_RULES.maxPlungeRate,
  })),
  maxCutDepth: limitSchema("maxCutDepth").default(() => ({
    ...DEFAULT_DESIGN_RULES.maxCutDepth,
  })),
  maxDepthUnderStock: limitSchema("maxDepthUnderStock").default(() => ({
    ...DEFAULT_DESIGN_RULES.maxDepthUnderStock,
  })),
  spindleStoppedWhileCutting: CheckSchema.default(() => ({
    ...DEFAULT_DESIGN_RULES.spindleStoppedWhileCutting,
  })),
  rapidIntoStock: CheckSchema.default(() => ({
    ...DEFAULT_DESIGN_RULES.rapidIntoStock,
  })),
  programRules: ProgramRuleSeveritiesSchema.default(() => ({})),
})
export type DesignRules = z.infer<typeof DesignRulesSchema>

/** The default rules, as a new project starts with them. */
export const defaultDesignRules = (): DesignRules => DesignRulesSchema.parse({})

function sameProgramRules(
  a: DesignRules["programRules"],
  b: DesignRules["programRules"]
) {
  const ids = Object.keys(a)
  return (
    ids.length === Object.keys(b).length &&
    ids.every((id) => a[id]?.severity === b[id]?.severity)
  )
}

/** Whether two sets of rules set every limit and severity alike. */
export const sameDesignRules = (a: DesignRules, b: DesignRules) =>
  LIMIT_RULES.every(
    (rule) =>
      a[rule].value === b[rule].value && a[rule].severity === b[rule].severity
  ) &&
  CHECK_RULES.every((rule) => a[rule].severity === b[rule].severity) &&
  sameProgramRules(a.programRules, b.programRules)
