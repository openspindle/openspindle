import type { Diagnostic, Subject } from "../diagnostics"
import type { StageFailure } from "./stages"

/**
 * A failure of a stage whose failures are diagnostics, as a plate's diagnostic: coded by its
 * rule's id, with the rule's problem as the message, about what the rule names (else `about`),
 * where on the bed, with the first fix the rule offers.
 */
export function failureDiagnostic<TName extends "tool" | "operation" | "run">(
  failure: StageFailure<TName>,
  about: Subject
): Diagnostic {
  const { rule } = failure
  const { problem, about: subject = about, places } = rule.explain(failure)
  const fix = rule.fixes?.offer(failure).at(0)
  return {
    severity: failure.severity,
    code: rule.id,
    message: problem,
    subject,
    ...(places && { places }),
    ...(fix && { fix }),
  }
}
