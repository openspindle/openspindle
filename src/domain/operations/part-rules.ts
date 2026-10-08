import { operationSubject } from "../diagnostics"
import { plural } from "../primitives"
import { editOperation } from "../rules/diagnostics"
import type { OperationRuleSubject, StageRule } from "../rules/stages"
import { suppressedParts } from "./toolpath-parts"

/** The parts an operation suppresses; null for one that suppresses none. */
const suppressing = ({ operation }: OperationRuleSubject) =>
  operation.suppressedParts?.length ? suppressedParts(operation) : null

const partsFound: StageRule<"operation"> = {
  id: "parts/unmatched",
  stage: "operation",
  label: "Suppressed paths found",
  description:
    "A path is suppressed by where it is, so it stays suppressed when its toolpath is generated again; one that no path lies at any more suppresses nothing.",
  severity: "warning",
  configurable: false,
  test: (subject) => !suppressing(subject)?.unmatched.length,
  explain: ({ first }) => {
    const missing = suppressing(first)?.unmatched.length ?? 0
    return {
      problem: `${plural(missing, "suppressed path")} of ${first.operation.name} no longer ${missing === 1 ? "matches" : "match"} a path of its toolpath, which cuts elsewhere now. Check which paths it suppresses.`,
      about: operationSubject(first.operation.id),
    }
  },
  fixes: editOperation,
}

const somePartsRun: StageRule<"operation"> = {
  id: "parts/all-suppressed",
  stage: "operation",
  label: "Paths left to cut",
  description:
    "An operation whose paths are all suppressed still changes tools and starts the spindle, to cut nothing.",
  severity: "warning",
  configurable: false,
  test: (subject) => {
    const parts = suppressing(subject)
    return !parts || parts.matched.size < parts.parts.length
  },
  explain: ({ first }) => ({
    problem: `Every path of ${first.operation.name} is suppressed, so it changes tools and starts the spindle to cut nothing. Suppress the operation instead.`,
    about: operationSubject(first.operation.id),
  }),
  fixes: editOperation,
}

/** What suppressing parts of an operation's toolpath leaves to check. */
export const PART_RULES: readonly StageRule<"operation">[] = [
  partsFound,
  somePartsRun,
]
