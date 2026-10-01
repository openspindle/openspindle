import { runRules } from "@/machine/contract"
import type { FixtureKit } from "../fixtures/fixture-kit"
import { initialModalState, nextModalState } from "../nc/modal-state"
import { programLines } from "../nc/program-lines"
import type { ProgramLines } from "../nc/program-lines"
import type { Operation, SourceOf } from "../operations/operation"
import { rulesOf } from "../rules/rules"
import type { ProgramSubject, StageFailure } from "../rules/stages"

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

export const IGNORE: ResolutionChoice = {
  resolution: "ignore",
  label: "Ignore",
  description: "Keep the program as it is.",
}

/**
 * A program rule's failure as an issue: its rule's problem and advice, the lines it is on, and
 * the changes the rule offers, then Ignore.
 */
export function programIssue(failure: StageFailure<"program">): ProgramIssue {
  const { rule, first } = failure
  const { problem, advice } = rule.explain(failure)
  const fixes = rule.fixes?.offer(failure) ?? []
  return {
    rule: rule.id,
    problem,
    lines: rule.locate?.(first) ?? [],
    advice,
    choices: fixes.length ? [fixes[0], ...fixes.slice(1), IGNORE] : [IGNORE],
  }
}

/** The change an issue suggests: its first choice, unless all it offers is Ignore. */
export function suggestedChoice(issue: ProgramIssue): ResolutionChoice | null {
  const [first] = issue.choices
  return first.resolution === "ignore" ? null : first
}

/** What resolves an issue, in words: the change it suggests, else its advice. */
export const suggestionOf = (issue: ProgramIssue) =>
  suggestedChoice(issue)?.label ?? issue.advice ?? IGNORE.label

/** What a program leaves set for the one after it: its last spindle speed, else what it started with. */
export function programEnd(
  program: ProgramLines,
  start: ProgramStart
): ProgramStart {
  let state = initialModalState()
  for (const block of program.blocks) state = nextModalState(state, block)
  return { spindleSpeed: state.spindleSpeed ?? start.spindleSpeed }
}

/**
 * The program with what the program rules of `kit`'s machine find in it resolved as chosen, by
 * rule id, from its start: each rule in turn, in the rules' order, makes the change it offers
 * with the chosen resolution. Lines keep their numbers; a program nothing resolves comes back as
 * it was, byte for byte.
 */
export function resolveProgram(
  text: string,
  kit: FixtureKit,
  resolutions: Readonly<Record<string, Resolution>>,
  start: ProgramStart
): string {
  let subject: ProgramSubject = { program: programLines(text), start }
  let changed = false
  for (const rule of rulesOf("program")) {
    const resolution = resolutions[rule.id] ?? "ignore"
    const { fixes } = rule
    if (resolution === "ignore" || !fixes?.apply) continue
    for (const failure of runRules([rule], [subject], { machine: kit.id })) {
      const fix = fixes
        .offer(failure)
        .find((item) => item.resolution === resolution)
      if (!fix) continue
      subject = fixes.apply(subject, fix)
      changed = true
    }
  }
  return changed ? subject.program.lines.join("\n") : text
}

/**
 * An NC file operation's source with what one of its machine's rules finds in it resolved as
 * chosen, from what the operation starts with; null for an operation whose NC is not its own to
 * change (PCB, or generated), or with nothing left for the rule to find.
 */
export function resolvedFileSource(
  operation: Operation,
  kit: FixtureKit,
  rule: string,
  resolution: Exclude<Resolution, "ignore">,
  start: ProgramStart
): SourceOf<"file"> | null {
  const { source } = operation
  if (source.kind !== "file") return null
  const nc = resolveProgram(source.nc, kit, { [rule]: resolution }, start)
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
