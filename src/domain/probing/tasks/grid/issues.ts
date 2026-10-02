import { issueOf } from "../../../diagnostics"
import type { Issue } from "../../../diagnostics"

export type GridIssueCode =
  // Parameters, within the ranges the method gives them on the machine
  | "invalid-parameters"
  // Anchor placement against the plate's anchor snapshot
  | "anchor-snapshot-missing"
  | "anchor-unavailable"
  | "anchor-grid-out-of-range"

/** What blocks generating a grid's NC; the compiler reports it. */
export type GridIssue = Issue<GridIssueCode>

export const gridError = issueOf<GridIssueCode>("error")
