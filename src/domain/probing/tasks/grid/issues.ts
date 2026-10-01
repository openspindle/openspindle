import { issueOf } from "../../../diagnostics"
import type { Issue } from "../../../diagnostics"

export type GridIssueCode =
  // Parameters, within the ranges of the machine's probe
  | "invalid-parameters"
  // Anchor placement against the plate's anchor snapshot
  | "anchor-snapshot-missing"
  | "anchor-unavailable"
  | "anchor-grid-out-of-range"
  | "factory-anchors"
  // Stock
  | "stock-unspecified"
  | "grid-exceeds-stock"
  | "grid-outside-stock"
  // Run against the connected machine
  | "anchors-not-read"
  | "live-anchors-unavailable"
  | "anchors-changed"

/** Errors block NC generation or Run; warnings inform without blocking. */
export type GridIssue = Issue<GridIssueCode>

export const gridError = issueOf<GridIssueCode>("error")
export const gridWarning = issueOf<GridIssueCode>("warning")
