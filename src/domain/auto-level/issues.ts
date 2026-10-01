import { issueOf } from "../diagnostics"
import type { Issue } from "../diagnostics"

export type AutoLevelIssueCode =
  // Parameters, within the ranges of the machine's probe
  | "invalid-parameters"
  // Anchor placement against the plate's anchor snapshot
  | "anchor-snapshot-missing"
  | "anchor-unavailable"
  | "anchor-grid-out-of-range"

/** What blocks generating an auto-level's NC; the compiler reports it. */
export type AutoLevelIssue = Issue<AutoLevelIssueCode>

export const autoLevelError = issueOf<AutoLevelIssueCode>("error")
