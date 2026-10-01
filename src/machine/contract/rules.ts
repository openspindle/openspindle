import { z } from "zod"

/** How a broken rule is reported: as an error, which blocks what the rule guards, as a warning, or not at all. */
export const RuleSeveritySchema = z.enum(["error", "warning", "ignore"])
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>

/** A severity a failure is reported at. */
export type ReportedSeverity = Exclude<RuleSeverity, "ignore">

/** A rule's limit: its unit, the range a project may set it in, and its default. */
export type RuleLimit = {
  readonly unit: "mm" | "mm/min"
  readonly min: number
  readonly max: number
  readonly default: number
}

/**
 * What one stage of checking hands its rules: the subject a test takes, the change a fix makes,
 * and what a failure's text adds for the stage's views.
 */
export type RuleStage = {
  readonly subject: unknown
  /** `never` for a stage whose rules offer no fixes. */
  readonly fix: unknown
  readonly details: object
}

/** Lines of a program, one-based and inclusive. */
export type RuleLines = { readonly start: number; readonly end: number }

/**
 * How a rule fails in one run, as its views need it: at what severity and limit, in which group,
 * its first and worst failing subjects, how often, and on which lines.
 */
export type RuleFailure<TSubject> = {
  readonly severity: ReportedSeverity
  /** The limit it was tested at: the project's, else its default; 0 for a rule without one. */
  readonly limit: number
  /** The group it failed in (`RuleRun.group`); null where each subject fails on its own. */
  readonly group: string | null
  readonly first: TSubject
  /** The subject that breaks it furthest (`measure`); the first for a rule without a measure. */
  readonly worst: TSubject
  /** How many lines break it (`locate`); for a rule without lines, how many subjects. */
  readonly count: number
  /** The lines that break it, in order, consecutive ones merged; empty for a rule without lines. */
  readonly lines: readonly RuleLines[]
}

/** What a failure says, as its rule words it. */
export type RuleText = {
  /** What goes wrong: "The Z1 ignores M4, so the spindle stays off." */
  readonly problem: string
  /** What resolves it where its fixes do not: "Cut at 2,000 mm/min or slower." */
  readonly advice?: string
  /** What its worst subject is, as results name it: "fastest", "deepest"; "first" without. */
  readonly worst?: string
}

/** The changes a rule offers for its failures, and how one is made. */
export type RuleFixes<TSubject, TFix> = {
  /** What it offers for a failure, the suggested change first; none where it has nothing to change. */
  readonly offer: (failure: RuleFailure<TSubject>) => readonly TFix[]
  /** The subject with an offered change made; absent where a view makes it (a machine action, a dialog). */
  readonly apply?: (subject: TSubject, fix: TFix) => TSubject
}

/**
 * Something the subjects of one stage keep or break. Running it is `test` alone: whether a
 * subject passes. `locate` and `measure` say where and how far a failing subject breaks it, for
 * its failure; `explain` words a failure and `fixes` offers what changes it, for views. A project
 * sets how a configurable rule is reported, and its limit. An interface, so that `runRules` infers
 * a list's stage from its rules.
 */
export interface Rule<TName extends string, TStage extends RuleStage> {
  /** Unique among all rules; a project's settings keep a rule by it. */
  readonly id: string
  readonly stage: TName
  /** As settings and results name it: "Max cutting feed", "Spindle reverse (M4)". */
  readonly label: string
  /** What breaks it, and what happens then. */
  readonly description: string
  /** How a failure is reported unless a project sets otherwise. */
  readonly severity: RuleSeverity
  /** Whether a project sets how it is reported, and its limit; otherwise it is always reported at its own. */
  readonly configurable: boolean
  readonly limit?: RuleLimit
  /** The machines it holds for, by fixture kit id (`FixtureKit.id`); every machine without. */
  readonly machines?: readonly string[]
  /**
   * The gates it is one of: a subject that fails a rule of the chain is not tested against the
   * rules after it in the chain, which assume it passed.
   */
  readonly chain?: string
  /** Whether a subject keeps the rule, at the limit it is tested at (0 for a rule without one). */
  readonly test: (subject: TStage["subject"], limit: number) => boolean
  /** The one-based program lines where a failing subject breaks it. */
  readonly locate?: (subject: TStage["subject"]) => readonly number[]
  /** How far a failing subject breaks it (its feed, its depth); the furthest is its failure's worst. */
  readonly measure?: (subject: TStage["subject"]) => number
  readonly explain: (
    failure: RuleFailure<TStage["subject"]>
  ) => RuleText & TStage["details"]
  readonly fixes?: RuleFixes<TStage["subject"], TStage["fix"]>
}

/** How a project sets one rule: how it is reported, and its limit for a rule with one. */
export type RuleSetting = {
  readonly severity: RuleSeverity
  readonly limit?: number
}

/** A project's settings by rule id; a rule it does not set is reported at its own severity and limit. */
export type RuleSettings = Readonly<Record<string, RuleSetting>>

/** A rule's failure in a run, with the rule, for views to explain and fix. */
export type RuleResult<
  TName extends string,
  TStage extends RuleStage,
> = RuleFailure<TStage["subject"]> & { readonly rule: Rule<TName, TStage> }

/** Which rules a run tests, and how it groups their failures. */
export type RuleRun<TSubject> = {
  readonly settings?: RuleSettings
  /** Only the rules reported at this severity or above; "error" for the rules that block. Default "warning". */
  readonly level?: ReportedSeverity
  /** Only the rules for this machine (fixture kit id), and those for every machine; every rule without. */
  readonly machine?: string
  /** The group a subject's failures are reported in: one failure per rule and group. Without, each subject fails on its own. */
  readonly group?: (subject: TSubject) => string
}

/** How much of what breaks a rule is reported: an error is reported wherever a warning is. */
const REPORTED: Readonly<Record<RuleSeverity, number>> = {
  ignore: 0,
  warning: 1,
  error: 2,
}

/** How a project reports a rule, and its limit: as the project sets a configurable rule, else as the rule says. */
export function ruleSetting(
  rule: Pick<
    Rule<string, RuleStage>,
    "id" | "severity" | "configurable" | "limit"
  >,
  settings: RuleSettings
): { readonly severity: RuleSeverity; readonly limit: number } {
  const setting =
    rule.configurable && Object.hasOwn(settings, rule.id)
      ? settings[rule.id]
      : undefined
  return {
    severity: setting?.severity ?? rule.severity,
    limit: rule.limit ? (setting?.limit ?? rule.limit.default) : 0,
  }
}

/** A failure as a run records it, with how far its worst subject breaks the rule. */
type Recorded<TName extends string, TStage extends RuleStage> = {
  readonly rule: Rule<TName, TStage>
  readonly severity: ReportedSeverity
  readonly limit: number
  readonly group: string | null
  readonly first: TStage["subject"]
  worst: TStage["subject"]
  /** What `measure` gives for `worst`; -Infinity until it has measured one. */
  furthest: number
  count: number
  readonly lines: { start: number; end: number }[]
}

/** Adds a failing subject to its rule's failure: its worst so far, its lines, its count. */
function record<TName extends string, TStage extends RuleStage>(
  failure: Recorded<TName, TStage>,
  subject: TStage["subject"]
) {
  const { rule } = failure
  if (rule.measure) {
    const value = rule.measure(subject)
    if (value > failure.furthest) {
      failure.furthest = value
      failure.worst = subject
    }
  }
  if (!rule.locate) {
    failure.count++
    return
  }
  for (const line of rule.locate(subject)) {
    const last = failure.lines.at(-1)
    if (last && line <= last.end) continue
    failure.count++
    if (last && line === last.end + 1) last.end = line
    else failure.lines.push({ start: line, end: line })
  }
}

/** Tests subjects against one stage's rules, as `run` scopes them: the failures, in the order subjects first fail them. */
export function runRules<TName extends string, TStage extends RuleStage>(
  rules: readonly Rule<TName, TStage>[],
  subjects: Iterable<TStage["subject"]>,
  run: RuleRun<TStage["subject"]> = {}
): RuleResult<TName, TStage>[] {
  const { settings = {}, level = "warning", machine, group } = run
  const tested = rules.flatMap((rule) => {
    if (
      machine !== undefined &&
      rule.machines &&
      !rule.machines.includes(machine)
    )
      return []
    const { severity, limit } = ruleSetting(rule, settings)
    return severity !== "ignore" && REPORTED[severity] >= REPORTED[level]
      ? [{ rule, severity, limit }]
      : []
  })
  const failures = new Map<string, Recorded<TName, TStage>>()
  let index = 0
  for (const subject of subjects) {
    const name = group ? group(subject) : null
    const key = name ?? index
    index++
    const failedChains = new Set<string>()
    for (const { rule, severity, limit } of tested) {
      if (rule.chain !== undefined && failedChains.has(rule.chain)) continue
      if (rule.test(subject, limit)) continue
      if (rule.chain !== undefined) failedChains.add(rule.chain)
      const id = JSON.stringify([rule.id, key])
      let failure = failures.get(id)
      if (!failure) {
        failure = {
          rule,
          severity,
          limit,
          group: name,
          first: subject,
          worst: subject,
          furthest: -Infinity,
          count: 0,
          lines: [],
        }
        failures.set(id, failure)
      }
      record(failure, subject)
    }
  }
  return Array.from(failures.values(), (failure) => ({
    rule: failure.rule,
    severity: failure.severity,
    limit: failure.limit,
    group: failure.group,
    first: failure.first,
    worst: failure.worst,
    count: failure.count,
    lines: failure.lines,
  }))
}

/**
 * Rules as a Standard Schema of their subject's input, for a form (TanStack Form) to validate a
 * field or a form with: it passes when every rule passes, and each failure is one of its issues,
 * with the rule's problem as the message and its id (`params.rule`). It parses what `schema` parses
 * (`TRaw`), so it pipes where `schema` would.
 */
export function rulesSchema<
  TInput,
  TName extends string,
  TStage extends RuleStage,
  TRaw = TInput,
>(
  schema: z.ZodType<TInput, TRaw>,
  rules: readonly Rule<TName, TStage>[],
  subjectOf: (input: TInput) => TStage["subject"],
  run?: RuleRun<TStage["subject"]>
): z.ZodType<TInput, TRaw> {
  return schema.superRefine((input, context) => {
    for (const failure of runRules(rules, [subjectOf(input)], run))
      context.addIssue({
        code: "custom",
        message: failure.rule.explain(failure).problem,
        params: { rule: failure.rule.id },
      })
  })
}
