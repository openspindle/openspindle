import type { RuleFixes } from "@/machine/contract"
import type { Diagnostic, QuickFix, Subject } from "../diagnostics"
import type { OperationRuleSubject, StageFailure } from "./stages"

/** What an operation rule offers where the operation's own settings resolve it: editing the operation. */
export const editOperation: RuleFixes<OperationRuleSubject, QuickFix> = {
  offer: ({ first }) => [
    { kind: "edit-operation", operationId: first.operation.id },
  ],
}

/**
 * A failure of a stage whose failures are diagnostics, as a plate's diagnostic: coded by its
 * rule's id, with the rule's problem as the message and its advice, about what the rule names
 * (else `about`), where on the bed, with the first fix the rule offers.
 */
export function failureDiagnostic<TName extends "tool" | "operation" | "run">(
  failure: StageFailure<TName>,
  about: Subject
): Diagnostic {
  const { rule } = failure
  const {
    problem,
    advice,
    about: subject = about,
    places,
  } = rule.explain(failure)
  const fix = rule.fixes?.offer(failure).at(0)
  return {
    severity: failure.severity,
    code: rule.id,
    message: problem,
    subject,
    ...(advice && { advice }),
    ...(places && { places }),
    ...(fix && { fix }),
  }
}
