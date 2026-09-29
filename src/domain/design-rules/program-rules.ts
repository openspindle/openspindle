import { initialModalState, nextModalState } from "../nc/modal-state"
import { programLines } from "../nc/program-lines"
import type { ProgramLines } from "../nc/program-lines"
import type { Operation, SourceOf } from "../operations/operation"
import type { DesignRules, RuleSeverity } from "./rules"

/** What is done about an issue: nothing, or a change its rule makes to the program. */
export type Resolution = "ignore" | "drop" | "replace"

/** One way of resolving an issue: what it does to the program. */
export type ResolutionChoice = {
  readonly resolution: Resolution
  readonly label: string
  readonly description: string
}

/**
 * What a program rule finds in a program: the problem, the lines it is on, and the ways to
 * resolve it, the suggested one first and Ignore last.
 */
export type ProgramIssue = {
  /** The rule that found it. */
  readonly rule: string
  /** What goes wrong where the machine runs the program: "M4 leaves the spindle off." */
  readonly problem: string
  /** One-based lines of the program. */
  readonly lines: readonly number[]
  /** What to do about it where the rule has no change to make: all it offers is Ignore. */
  readonly advice?: string
  readonly choices: readonly [ResolutionChoice, ...ResolutionChoice[]]
}

/**
 * What a program starts with where it runs: what runs before it leaves set. Programs a CAM
 * exports one per operation may count on it, such as the spindle speed an earlier one sets.
 */
export type ProgramStart = {
  /** The spindle speed set before it; null where nothing before it sets one. */
  readonly spindleSpeed: number | null
}

/** A program with nothing before it: the first of several, or one on its own. */
export const FRESH_START: ProgramStart = { spindleSpeed: null }

/**
 * A design rule for the programs a machine runs: something it does not run as written, or that
 * does not stand on its own. It finds that in a program, knowing what the program starts with,
 * and resolves it as chosen; `ignore` never reaches `resolve`, and the program stays as it is.
 */
export type ProgramRule = {
  readonly id: string
  /** As the design rules name it: "Spindle reverse (M4)". */
  readonly label: string
  /** What breaks it, and what the machine does instead. */
  readonly description: string
  /** How a program that breaks it is reported unless the project sets otherwise. */
  readonly severity: RuleSeverity
  find: (program: ProgramLines, start: ProgramStart) => ProgramIssue | null
  resolve: (
    program: ProgramLines,
    resolution: Exclude<Resolution, "ignore">,
    start: ProgramStart
  ) => readonly string[]
}

export const IGNORE: ResolutionChoice = {
  resolution: "ignore",
  label: "Ignore",
  description: "Keep the program as it is.",
}

/** The change an issue suggests: its first choice, unless all it offers is Ignore. */
export function suggestedChoice(issue: ProgramIssue): ResolutionChoice | null {
  const [first] = issue.choices
  return first.resolution === "ignore" ? null : first
}

/** What resolves an issue, in words: the change it suggests, else its advice. */
export const suggestionOf = (issue: ProgramIssue) =>
  suggestedChoice(issue)?.label ?? issue.advice ?? IGNORE.label

/** How a project reports a program that breaks a machine's rule: as it sets, else as the rule says. */
export const programRuleSeverity = (
  rules: DesignRules,
  rule: ProgramRule
): RuleSeverity => rules.programRules[rule.id]?.severity ?? rule.severity

/** A machine's rules a project reports, as an error or a warning. */
export const reportedProgramRules = (
  rules: DesignRules,
  programRules: readonly ProgramRule[]
) =>
  programRules.filter((rule) => programRuleSeverity(rules, rule) !== "ignore")

/** What a program leaves set for the one after it: its last spindle speed, else what it started with. */
export function programEnd(
  program: ProgramLines,
  start: ProgramStart
): ProgramStart {
  let state = initialModalState()
  for (const block of program.blocks) state = nextModalState(state, block)
  return { spindleSpeed: state.spindleSpeed ?? start.spindleSpeed }
}

/** What rules find in a program, in the order of the rules. */
export function findIssues(
  text: string,
  rules: readonly ProgramRule[],
  start: ProgramStart = FRESH_START
): ProgramIssue[] {
  const program = programLines(text)
  return rules.flatMap((rule) => rule.find(program, start) ?? [])
}

/**
 * The program with each rule's issue resolved as chosen, by rule id; lines keep their numbers.
 * A program nothing resolves comes back as it was, byte for byte.
 */
export function resolveIssues(
  text: string,
  rules: readonly ProgramRule[],
  resolutions: Readonly<Record<string, Resolution>>,
  start: ProgramStart = FRESH_START
): string {
  let program = programLines(text)
  let changed = false
  for (const rule of rules) {
    const resolution = resolutions[rule.id] ?? "ignore"
    if (resolution === "ignore" || !rule.find(program, start)) continue
    program = programLines(rule.resolve(program, resolution, start).join("\n"))
    changed = true
  }
  return changed ? program.lines.join("\n") : text
}

/**
 * An NC file operation's source with what one of its machine's rules finds in it resolved as
 * chosen, from what the operation starts with; null for an operation whose NC is not its own to
 * change (a plugin's, or generated), or with nothing left for the rule to find.
 */
export function resolvedFileSource(
  operation: Operation,
  rules: readonly ProgramRule[],
  rule: string,
  resolution: Exclude<Resolution, "ignore">,
  start: ProgramStart
): SourceOf<"file"> | null {
  const { source } = operation
  if (source.kind !== "file") return null
  const nc = resolveIssues(source.nc, rules, { [rule]: resolution }, start)
  if (nc === source.nc) return null
  if (!source.origin) return { ...source, nc }
  // NC that came from elsewhere keeps the resolution, for its updates to resolve alike.
  const { resolutions } = source.origin
  return {
    ...source,
    nc,
    origin: {
      ...source.origin,
      resolutions: { ...resolutions, [rule]: resolution },
    },
  }
}
